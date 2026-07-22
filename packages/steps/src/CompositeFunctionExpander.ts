/**
 * Expands local composite functions (`uses: ./path/to/function`) into a
 * {@link CompositeBuildStep} tree at parse time.
 *
 * Each call becomes a node with prefixed child ids (`caller__inner`); the parser
 * flattens the tree into the workflow. Expanded steps carry a
 * {@link BuildStepCompositeFunctionScope} so `${{ steps.* }}` and `${{ inputs.* }}`
 * resolve against composite-function-local names.
 */
import {
  CompositeFunctionCatalog,
  CompositeFunctionConfig,
  FunctionStep,
  ShellStep,
  Step,
  isStepFunctionStep,
  isStepShellStep,
} from '@expo/eas-build-job';

import { BuildFunctionById } from './BuildFunction';
import { BuildFunctionGroupById } from './BuildFunctionGroup';
import { BuildStep, BuildStepOutputAccessor } from './BuildStep';
import { BuildStepCompositeFunctionScope } from './BuildStepCompositeFunctionScope';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepEnv } from './BuildStepEnv';
import {
  BuildStepInput,
  BuildStepInputValueTypeName,
  getDisallowedInputValueError,
} from './BuildStepInput';
import { CompositeBuildStep } from './CompositeBuildStep';
import { BuildConfigError } from './errors';
import { duplicates } from './utils/expodash/duplicates';
import {
  getLocalCompositeFunctionCallWorkingDirectoryError,
  isLocalCompositeFunctionPath,
  parseLocalCompositeFunctionPath,
} from './utils/localCompositeFunctions';
import { createBuildStepOutputsFromDefinition, getShellStepDisplayName } from './utils/step';

const MAX_COMPOSITE_FUNCTION_NESTING_DEPTH = 10;

export type FunctionMaps = {
  buildFunctionById: BuildFunctionById;
  buildFunctionGroupById: BuildFunctionGroupById;
};

type CompositeFunctionCall = {
  compositeFunctionPath: string;
  /** Caller-assigned id used as prefix for all inner step ids. */
  syntheticStepId: string;
  name?: string;
  /** Caller-provided input values, consumed when composite function inputs are interpolated. */
  callWith?: Record<string, unknown>;
  callIf?: string;
  parentScope?: BuildStepCompositeFunctionScope;
  inheritedEnv?: BuildStepEnv;
};

type StepOverrides = {
  env?: BuildStepEnv;
  workingDirectory?: string;
  ifCondition?: string;
};

export class CompositeFunctionExpander {
  constructor(
    private readonly ctx: BuildStepGlobalContext,
    private readonly compositeFunctionCatalog: CompositeFunctionCatalog,
    private readonly functionMaps: FunctionMaps
  ) {}

  public expandCompositeFunctionStep(
    step: FunctionStep,
    compositeFunctionPath: string,
    syntheticStepId: string
  ): CompositeBuildStep {
    this.rejectCompositeFunctionCallWorkingDirectory(step);
    return this.expand(
      {
        compositeFunctionPath,
        syntheticStepId,
        callWith: step.with,
        callIf: step.if,
        inheritedEnv: step.env,
      },
      new Set<string>()
    );
  }

  // The call step expands away; `working_directory` on it would never apply.
  private rejectCompositeFunctionCallWorkingDirectory(step: FunctionStep): void {
    if (step.working_directory !== undefined) {
      throw new BuildConfigError(getLocalCompositeFunctionCallWorkingDirectoryError(step.uses));
    }
  }

  // `visited.size` is the current composite function nesting depth.
  private expand(call: CompositeFunctionCall, visited: ReadonlySet<string>): CompositeBuildStep {
    const { compositeFunctionPath, syntheticStepId } = call;
    this.guardAgainstRunawayRecursion(compositeFunctionPath, visited);

    const compositeFunction = this.lookupCompositeFunction(compositeFunctionPath);
    const compositeFunctionDisplayName =
      call.name ?? compositeFunction.name ?? compositeFunctionPath;
    const innerSteps = compositeFunction.runs.steps;

    const innerStepIds = this.buildInnerStepIdMap(
      innerSteps,
      syntheticStepId,
      compositeFunctionPath
    );
    const { inputs, providedInputKeys } = this.buildCompositeFunctionInputs(
      compositeFunction,
      compositeFunctionPath,
      call.callWith
    );

    const nestedVisited = new Set(visited).add(compositeFunctionPath);

    const childrenByLocalId = new Map<string, BuildStepOutputAccessor>();
    const scope = new BuildStepCompositeFunctionScope({
      ctx: this.ctx,
      parent: call.parentScope,
      ifCondition: call.callIf,
      env: call.inheritedEnv,
      compositeFunctionPath,
      inputs,
      providedInputKeys,
      childrenByLocalId,
    });

    const children = innerSteps.map((innerStep, index) => {
      const { localId, newId } = innerStepIds[index];
      const child = this.expandInnerStep(innerStep, newId, {
        compositeFunctionPath,
        scope,
        nestedVisited,
      });
      // Omit output-less nested nodes: `${{ steps.mid }}` is undefined today,
      // and `{ outputs: {} }` would make it truthy.
      if (!(child instanceof CompositeBuildStep) || child.hasDeclaredOutputs) {
        childrenByLocalId.set(localId, child);
      }
      return child;
    });

    return new CompositeBuildStep(this.ctx, {
      id: syntheticStepId,
      displayName: compositeFunctionDisplayName,
      scope,
      children,
    });
  }

  private guardAgainstRunawayRecursion(
    compositeFunctionPath: string,
    visited: ReadonlySet<string>
  ): void {
    if (visited.has(compositeFunctionPath)) {
      const cyclePath = [...visited, compositeFunctionPath].join(' -> ');
      throw new BuildConfigError(
        `Detected a cycle while expanding composite functions: ${cyclePath}. A composite function cannot reference itself, directly or indirectly.`
      );
    }
    if (visited.size >= MAX_COMPOSITE_FUNCTION_NESTING_DEPTH) {
      throw new BuildConfigError(
        `Maximum composite function nesting depth (${MAX_COMPOSITE_FUNCTION_NESTING_DEPTH}) exceeded while expanding composite function "${compositeFunctionPath}".`
      );
    }
  }

  private lookupCompositeFunction(compositeFunctionPath: string): CompositeFunctionConfig {
    const compositeFunction = this.compositeFunctionCatalog[compositeFunctionPath];
    if (!compositeFunction) {
      throw new BuildConfigError(
        `Local composite function "${compositeFunctionPath}" does not exist. Expected a "function.yml" (or "function.yaml") file at "${compositeFunctionPath}" relative to the EAS project root (convention: ".eas/functions/<name>").`
      );
    }
    return compositeFunction;
  }

  private expandInnerStep(
    innerStep: Step,
    newId: string,
    {
      compositeFunctionPath,
      scope,
      nestedVisited,
    }: {
      compositeFunctionPath: string;
      scope: BuildStepCompositeFunctionScope;
      nestedVisited: ReadonlySet<string>;
    }
  ): BuildStep {
    const overrides = this.resolveStepOverrides(innerStep);

    if (isStepFunctionStep(innerStep)) {
      if (isLocalCompositeFunctionPath(innerStep.uses)) {
        this.rejectCompositeFunctionCallWorkingDirectory(innerStep);
        return this.expandNestedCompositeFunctionCall(innerStep, {
          compositeFunctionPath: parseLocalCompositeFunctionPath(innerStep.uses),
          newId,
          overrides,
          scope,
          visited: nestedVisited,
        });
      }
      return this.createExpandedFunctionStep(innerStep, {
        newId,
        overrides,
        scope,
        compositeFunctionPath,
      });
    }
    if (isStepShellStep(innerStep)) {
      return this.createExpandedShellStep(innerStep, { newId, overrides, scope });
    }
    throw new BuildConfigError(
      `Invalid step configuration in composite function "${compositeFunctionPath}". Step must be a shell or function step.`
    );
  }

  private resolveStepOverrides(innerStep: Step): StepOverrides {
    return {
      env: innerStep.env,
      ifCondition: innerStep.if,
      workingDirectory: innerStep.working_directory,
    };
  }

  private expandNestedCompositeFunctionCall(
    innerStep: FunctionStep,
    {
      compositeFunctionPath,
      newId,
      overrides,
      scope,
      visited,
    }: {
      compositeFunctionPath: string;
      newId: string;
      overrides: StepOverrides;
      scope: BuildStepCompositeFunctionScope;
      visited: ReadonlySet<string>;
    }
  ): CompositeBuildStep {
    return this.expand(
      {
        compositeFunctionPath,
        syntheticStepId: newId,
        callWith: innerStep.with,
        callIf: overrides.ifCondition,
        parentScope: scope,
        inheritedEnv: overrides.env,
      },
      visited
    );
  }

  private createExpandedShellStep(
    step: ShellStep,
    {
      newId,
      overrides,
      scope,
    }: {
      newId: string;
      overrides: StepOverrides;
      scope: BuildStepCompositeFunctionScope;
    }
  ): BuildStep {
    const command = step.run;
    const displayName = getShellStepDisplayName(step);
    const outputs =
      step.outputs && createBuildStepOutputsFromDefinition(this.ctx, step.outputs, displayName);
    return new BuildStep(this.ctx, {
      id: newId,
      displayName,
      outputs,
      workingDirectory: overrides.workingDirectory,
      shell: step.shell,
      command,
      env: overrides.env,
      ifCondition: overrides.ifCondition,
      compositeFunctionScope: scope,
      __metricsId: step.__metrics_id,
    });
  }

  private createExpandedFunctionStep(
    step: FunctionStep,
    {
      newId,
      overrides,
      scope,
      compositeFunctionPath,
    }: {
      newId: string;
      overrides: StepOverrides;
      scope: BuildStepCompositeFunctionScope;
      compositeFunctionPath: string;
    }
  ): BuildStep {
    const functionId = step.uses;
    const { buildFunctionById, buildFunctionGroupById } = this.functionMaps;
    const maybeFunctionGroup = buildFunctionGroupById[functionId];
    if (maybeFunctionGroup) {
      throw new BuildConfigError(
        `Function group "${functionId}" cannot be used inside a composite function. Function groups expand to multiple steps with their own ids and do not support composite-function-level id, env, if, or working_directory overrides. Use individual function steps instead.`
      );
    }

    const buildFunction = buildFunctionById[functionId];
    if (!buildFunction) {
      throw new BuildConfigError(
        `Composite function "${compositeFunctionPath}" calls non-existent function "${functionId}".`
      );
    }

    const callInputs = step.with as Record<string, unknown> | undefined;

    return buildFunction.createBuildStepFromFunctionCall(this.ctx, {
      id: newId,
      name: step.name,
      callInputs,
      workingDirectory: overrides.workingDirectory,
      shell: step.shell,
      env: overrides.env,
      ifCondition: overrides.ifCondition,
      compositeFunctionScope: scope,
    });
  }

  /**
   * Assigns globally unique ids to inner steps. Without namespacing, two
   * composite function calls with inner step `read` would collide.
   */
  private buildInnerStepIdMap(
    innerSteps: Step[],
    syntheticStepId: string,
    compositeFunctionPath: string
  ): Array<{ localId: string; newId: string }> {
    const declaredIdList = innerSteps.map(step => step.id).filter((id): id is string => !!id);
    const duplicatedIds = duplicates(declaredIdList);
    if (duplicatedIds.length > 0) {
      throw new BuildConfigError(
        `Composite function "${compositeFunctionPath}" declares duplicated step IDs: ${duplicatedIds
          .map(id => `"${id}"`)
          .join(', ')}. Step IDs within a composite function must be unique.`
      );
    }
    const declaredIds = new Set(declaredIdList);
    let generatedStepIdCounter = 0;
    return innerSteps.map(innerStep => {
      let localId = innerStep.id;
      if (!localId) {
        do {
          localId = `composite_function_step_${++generatedStepIdCounter}`;
        } while (declaredIds.has(localId));
      }
      return { localId, newId: `${syntheticStepId}__${localId}` };
    });
  }

  // Nullish `with` values are treated as absent so defaults resolve in the composite function's own scope.
  private buildCompositeFunctionInputs(
    compositeFunction: CompositeFunctionConfig,
    compositeFunctionPath: string,
    callWith: Record<string, unknown> | undefined
  ): { inputs: Map<string, BuildStepInput>; providedInputKeys: Set<string> } {
    const inputs = new Map<string, BuildStepInput>();
    const providedInputKeys = new Set<string>();
    for (const declared of compositeFunction.inputs ?? []) {
      const definition =
        typeof declared === 'string'
          ? {
              name: declared,
              type: 'string',
              required: false,
              allowedValues: undefined as unknown[] | undefined,
              defaultValue: undefined as unknown,
            }
          : {
              name: declared.name,
              type: declared.type,
              required: declared.required ?? false,
              allowedValues: declared.allowed_values,
              defaultValue: declared.default_value,
            };
      const input = new BuildStepInput(this.ctx, {
        id: definition.name,
        stepDisplayName: compositeFunctionPath,
        defaultValue: definition.defaultValue,
        required: definition.required,
        allowedValues: definition.allowedValues,
        allowedValueTypeName: this.toInputValueTypeName(
          definition.type,
          compositeFunctionPath,
          definition.name
        ),
      });
      if (callWith && Object.prototype.hasOwnProperty.call(callWith, definition.name)) {
        const value = callWith[definition.name];
        if (value !== undefined) {
          input.set(value);
        }
        if (value != null) {
          providedInputKeys.add(definition.name);
        }
      }
      const disallowedValueError = getDisallowedInputValueError(input, compositeFunctionPath);
      if (disallowedValueError) {
        throw new BuildConfigError(disallowedValueError);
      }
      inputs.set(definition.name, input);
    }
    return { inputs, providedInputKeys };
  }

  private toInputValueTypeName(
    type: string,
    compositeFunctionPath: string,
    inputName: string
  ): BuildStepInputValueTypeName {
    const supported = Object.values(BuildStepInputValueTypeName) as string[];
    if (!supported.includes(type)) {
      throw new BuildConfigError(
        `Composite function "${compositeFunctionPath}" input "${inputName}" has unsupported type "${type}". Supported types: ${supported.join(
          ', '
        )}.`
      );
    }
    return type as BuildStepInputValueTypeName;
  }
}
