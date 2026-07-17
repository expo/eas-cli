/**
 * Expands local composite functions (`uses: ./path/to/function`) into concrete {@link BuildStep}s
 * at parse time.
 *
 * A composite function call is not executed as a single step. Its `runs.steps` are flattened into the
 * workflow with prefixed ids (`caller__inner`) so the existing step runner can execute them.
 * Each expanded step carries a {@link BuildStepCompositeFunctionScope} so `${{ steps.* }}` and
 * `${{ inputs.* }}` inside the composite function resolve against composite-function-local names, not global ones.
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
import { BuildStep } from './BuildStep';
import { BuildStepCompositeFunctionScope } from './BuildStepCompositeFunctionScope';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepEnv } from './BuildStepEnv';
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
  /** Caller-assigned id used as prefix for all inner step ids and the composite function outputs step. */
  syntheticStepId: string;
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
  ): BuildStep[] {
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
  private expand(call: CompositeFunctionCall, visited: ReadonlySet<string>): BuildStep[] {
    const { compositeFunctionPath, syntheticStepId } = call;
    this.guardAgainstRunawayRecursion(compositeFunctionPath, visited);

    const compositeFunction = this.lookupCompositeFunction(compositeFunctionPath);
    const innerSteps = compositeFunction.runs.steps;

    const { stepIdMap, newIds } = this.buildInnerStepIdMap(
      innerSteps,
      syntheticStepId,
      compositeFunctionPath
    );

    const nestedVisited = new Set(visited).add(compositeFunctionPath);

    const scope = new BuildStepCompositeFunctionScope({
      ctx: this.ctx,
      parent: call.parentScope,
      ifCondition: call.callIf,
      env: call.inheritedEnv,
      stepIdAliases: stepIdMap,
    });

    const buildSteps = innerSteps.flatMap((innerStep, index) =>
      this.expandInnerStep(innerStep, newIds[index], {
        compositeFunctionPath,
        scope,
        nestedVisited,
      })
    );

    return buildSteps;
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
  ): BuildStep[] {
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
      return this.createExpandedFunctionSteps(innerStep, {
        newId,
        overrides,
        scope,
        compositeFunctionPath,
      });
    }
    if (isStepShellStep(innerStep)) {
      return [this.createExpandedShellStep(innerStep, { newId, overrides, scope })];
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
  ): BuildStep[] {
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
      isCompositeFunctionInternal: true,
      __metricsId: step.__metrics_id,
    });
  }

  private createExpandedFunctionSteps(
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
  ): BuildStep[] {
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

    return [
      buildFunction.createBuildStepFromFunctionCall(this.ctx, {
        id: newId,
        name: step.name,
        callInputs,
        workingDirectory: overrides.workingDirectory,
        shell: step.shell,
        env: overrides.env,
        ifCondition: overrides.ifCondition,
        compositeFunctionScope: scope,
        isCompositeFunctionInternal: true,
      }),
    ];
  }

  /**
   * Maps composite-function-local step ids to globally unique ids and builds the alias table for scope.
   * Without namespacing, two composite function calls with inner step `read` would collide in the workflow.
   */
  private buildInnerStepIdMap(
    innerSteps: Step[],
    syntheticStepId: string,
    compositeFunctionPath: string
  ): { stepIdMap: Map<string, string>; newIds: string[] } {
    const stepIdMap = new Map<string, string>();
    const newIds: string[] = [];
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
    for (const innerStep of innerSteps) {
      let sourceId = innerStep.id;
      if (!sourceId) {
        do {
          sourceId = `composite_function_step_${++generatedStepIdCounter}`;
        } while (declaredIds.has(sourceId));
      }
      const newId = `${syntheticStepId}__${sourceId}`;
      stepIdMap.set(sourceId, newId);
      newIds.push(newId);
    }
    return { stepIdMap, newIds };
  }
}
