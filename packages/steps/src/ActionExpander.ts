import {
  ActionCatalog,
  ActionConfig,
  FunctionStep,
  ShellStep,
  Step,
  getActionNotFoundError,
  isActionReference,
  isStepFunctionStep,
  isStepShellStep,
  parseActionReference,
} from '@expo/eas-build-job';

import { BuildFunctionById } from './BuildFunction';
import { BuildFunctionGroupById } from './BuildFunctionGroup';
import { BuildStep } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepEnv } from './BuildStepEnv';
import { BuildStepOutput } from './BuildStepOutput';
import { BuildConfigError } from './errors';
import {
  ActionInputInterpolator,
  StepReferenceRewriter,
  combineIfConditions,
  createActionInputInterpolator,
  createStepReferenceRewriter,
  isActionInputReference,
  mergeEnv,
  resolveActionOutputTemplate,
} from './utils/actionInterpolation';
import { createBuildStepOutputsFromDefinition, getShellStepDisplayName } from './utils/step';

const MAX_ACTION_NESTING_DEPTH = 10;

export type FunctionMaps = {
  buildFunctionById: BuildFunctionById;
  buildFunctionGroupById: BuildFunctionGroupById;
};

type ActionCall = {
  ref: string;
  syntheticStepId: string;
  callWith?: Record<string, unknown>;
  inheritedEnv?: BuildStepEnv;
  inheritedIf?: string;
  inheritedWorkingDirectory?: string;
};

type RecursionState = { visited: Set<string>; depth: number };

type StepOverrides = { env?: BuildStepEnv; ifCondition?: string; workingDirectory?: string };

export class ActionExpander {
  constructor(
    private readonly ctx: BuildStepGlobalContext,
    private readonly actionCatalog: ActionCatalog
  ) {}

  public expandActionCall(call: ActionCall, functionMaps: FunctionMaps): BuildStep[] {
    return this.expand(call, functionMaps, { visited: new Set<string>(), depth: 0 });
  }

  private expand(
    call: ActionCall,
    functionMaps: FunctionMaps,
    recursionState: RecursionState
  ): BuildStep[] {
    const { ref, syntheticStepId } = call;
    this.guardAgainstRunawayRecursion(ref, recursionState);

    const action = this.lookupAction(ref);
    const actionDisplayName = action.name ?? ref;
    const innerSteps = action.runs.steps;

    const { stepIdMap, newIds } = this.buildInnerStepIdMap(innerSteps, syntheticStepId);
    const rewriteStepReferences = createStepReferenceRewriter(stepIdMap);
    const inputValues = this.resolveActionInputValues(
      action,
      call.callWith,
      ref,
      rewriteStepReferences
    );
    const interpolator = createActionInputInterpolator({ inputValues, rewriteStepReferences, ref });

    const nestedRecursionState: RecursionState = {
      visited: new Set(recursionState.visited).add(ref),
      depth: recursionState.depth + 1,
    };

    const buildSteps = innerSteps.flatMap((innerStep, index) =>
      this.expandInnerStep(innerStep, newIds[index], {
        ref,
        actionDisplayName,
        interpolator,
        inherited: {
          env: call.inheritedEnv,
          ifCondition: call.inheritedIf,
          workingDirectory: call.inheritedWorkingDirectory,
        },
        functionMaps,
        nestedRecursionState,
      })
    );

    const syntheticOutputsStep = this.maybeCreateActionOutputsStep(action, {
      syntheticStepId,
      actionDisplayName,
      interpolator,
      env: call.inheritedEnv,
      ifCondition: call.inheritedIf,
      workingDirectory: call.inheritedWorkingDirectory,
    });

    return syntheticOutputsStep ? [...buildSteps, syntheticOutputsStep] : buildSteps;
  }

  private guardAgainstRunawayRecursion(ref: string, { visited, depth }: RecursionState): void {
    if (depth > MAX_ACTION_NESTING_DEPTH) {
      throw new BuildConfigError(
        `Maximum action nesting depth (${MAX_ACTION_NESTING_DEPTH}) exceeded while expanding action "${ref}".`
      );
    }
    if (visited.has(ref)) {
      const cyclePath = [...visited, ref].join(' -> ');
      throw new BuildConfigError(
        `Detected a cycle while expanding actions: ${cyclePath}. An action cannot reference itself, directly or indirectly.`
      );
    }
  }

  private lookupAction(ref: string): ActionConfig {
    const action = this.actionCatalog[ref];
    if (!action) {
      throw new BuildConfigError(getActionNotFoundError(ref));
    }
    return action;
  }

  private expandInnerStep(
    innerStep: Step,
    newId: string,
    {
      ref,
      actionDisplayName,
      interpolator,
      inherited,
      functionMaps,
      nestedRecursionState,
    }: {
      ref: string;
      actionDisplayName: string;
      interpolator: ActionInputInterpolator;
      inherited: StepOverrides;
      functionMaps: FunctionMaps;
      nestedRecursionState: RecursionState;
    }
  ): BuildStep[] {
    const overrides = this.resolveStepOverrides(innerStep, interpolator, inherited);

    if (isStepFunctionStep(innerStep) && isActionReference(innerStep.uses)) {
      return this.expandNestedActionCall(
        innerStep,
        newId,
        overrides,
        interpolator,
        functionMaps,
        nestedRecursionState
      );
    }
    if (isStepShellStep(innerStep)) {
      return [
        this.createExpandedShellStep(innerStep, newId, overrides, interpolator, actionDisplayName),
      ];
    }
    if (isStepFunctionStep(innerStep)) {
      return this.createExpandedFunctionSteps(
        innerStep,
        newId,
        overrides,
        interpolator,
        functionMaps,
        ref
      );
    }
    throw new BuildConfigError(
      `Invalid step configuration in action "${ref}". Step must be a shell or function step.`
    );
  }

  private resolveStepOverrides(
    innerStep: Step,
    interpolator: ActionInputInterpolator,
    inherited: StepOverrides
  ): StepOverrides {
    const env = mergeEnv(inherited.env, interpolator.interpolateEnv(innerStep.env));
    const ifCondition = combineIfConditions(
      inherited.ifCondition,
      innerStep.if !== undefined ? interpolator.interpolateString(innerStep.if) : undefined
    );
    const workingDirectory =
      innerStep.working_directory !== undefined
        ? interpolator.interpolateString(innerStep.working_directory)
        : inherited.workingDirectory;
    return { env, ifCondition, workingDirectory };
  }

  private expandNestedActionCall(
    innerStep: FunctionStep,
    newId: string,
    overrides: StepOverrides,
    interpolator: ActionInputInterpolator,
    functionMaps: FunctionMaps,
    recursionState: RecursionState
  ): BuildStep[] {
    const nestedCallWith = innerStep.with
      ? (interpolator.interpolateValue(innerStep.with) as Record<string, unknown>)
      : undefined;
    const parsed = parseActionReference(innerStep.uses);
    if (!parsed) {
      throw new BuildConfigError(`Invalid action reference "${innerStep.uses}".`);
    }
    return this.expand(
      {
        ref: parsed.ref,
        syntheticStepId: newId,
        callWith: nestedCallWith,
        inheritedEnv: overrides.env,
        inheritedIf: overrides.ifCondition,
        inheritedWorkingDirectory: overrides.workingDirectory,
      },
      functionMaps,
      recursionState
    );
  }

  private createExpandedShellStep(
    step: ShellStep,
    id: string,
    overrides: StepOverrides,
    interpolator: ActionInputInterpolator,
    actionDisplayName: string
  ): BuildStep {
    const command = interpolator.interpolateString(step.run);
    const displayName = getShellStepDisplayName({ ...step, run: command }) || actionDisplayName;
    const outputs =
      step.outputs && createBuildStepOutputsFromDefinition(this.ctx, step.outputs, displayName);
    return new BuildStep(this.ctx, {
      id,
      displayName,
      outputs,
      workingDirectory: overrides.workingDirectory,
      shell: step.shell,
      command,
      env: overrides.env,
      ifCondition: overrides.ifCondition,
      __metricsId: step.__metrics_id,
    });
  }

  private createExpandedFunctionSteps(
    step: FunctionStep,
    id: string,
    overrides: StepOverrides,
    interpolator: ActionInputInterpolator,
    { buildFunctionById, buildFunctionGroupById }: FunctionMaps,
    actionRef: string
  ): BuildStep[] {
    const functionId = step.uses;
    const maybeFunctionGroup = buildFunctionGroupById[functionId];
    if (maybeFunctionGroup) {
      throw new BuildConfigError(
        `Function group "${functionId}" cannot be used inside an action. Function groups expand to multiple steps with their own ids and do not support action-level id, env, if, or working_directory overrides. Use individual function steps instead.`
      );
    }

    const buildFunction = buildFunctionById[functionId];
    if (!buildFunction) {
      throw new BuildConfigError(
        `Action "${actionRef}" calls non-existent function "${functionId}".`
      );
    }

    const callInputs = step.with
      ? (interpolator.interpolateValue(step.with) as Record<string, unknown>)
      : undefined;

    return [
      buildFunction.createBuildStepFromFunctionCall(this.ctx, {
        id,
        name: step.name,
        callInputs,
        workingDirectory: overrides.workingDirectory,
        shell: step.shell,
        env: overrides.env,
        ifCondition: overrides.ifCondition,
      }),
    ];
  }

  private buildInnerStepIdMap(
    innerSteps: Step[],
    syntheticStepId: string
  ): { stepIdMap: Map<string, string>; newIds: string[] } {
    const stepIdMap = new Map<string, string>();
    const newIds: string[] = [];
    let generatedStepIdCounter = 0;
    for (const innerStep of innerSteps) {
      const sourceId = innerStep.id ?? `__action_step_${++generatedStepIdCounter}`;
      const newId = `${syntheticStepId}__${sourceId}`;
      stepIdMap.set(sourceId, newId);
      newIds.push(newId);
    }
    return { stepIdMap, newIds };
  }

  private resolveActionInputValues(
    action: ActionConfig,
    callWith: Record<string, unknown> | undefined,
    ref: string,
    rewriteStepReferences: StepReferenceRewriter
  ): Map<string, unknown> {
    const values = new Map<string, unknown>();
    const declaredInputNames = new Set(
      (action.inputs ?? []).map(input => (typeof input === 'string' ? input : input.name))
    );
    for (const providedName of Object.keys(callWith ?? {})) {
      if (!declaredInputNames.has(providedName)) {
        throw new BuildConfigError(
          `Action "${ref}" was called with unknown input "${providedName}". Declared inputs are: ${
            declaredInputNames.size > 0
              ? [...declaredInputNames].map(name => `"${name}"`).join(', ')
              : '(none)'
          }.`
        );
      }
    }
    for (const input of action.inputs ?? []) {
      const normalized =
        typeof input === 'string' ? { name: input, type: 'string' as const } : input;
      const name = normalized.name;
      const defaultValue = normalized.default_value;
      const inputType = normalized.type ?? 'string';
      const allowedValues = normalized.allowed_values;
      const required = normalized.required ?? false;
      const isProvided = callWith != null && Object.prototype.hasOwnProperty.call(callWith, name);
      let value = isProvided ? callWith[name] : defaultValue;
      if (value === undefined && required) {
        throw new BuildConfigError(
          `Action "${ref}" requires input "${name}" but it was not provided.`
        );
      }
      this.validateActionInputValue(ref, name, value, inputType, allowedValues);
      if (!isProvided && typeof value === 'string') {
        value = rewriteStepReferences(value);
      }
      values.set(name, value);
    }
    return values;
  }

  private validateActionInputValue(
    ref: string,
    inputName: string,
    value: unknown,
    inputType: string,
    allowedValues?: unknown[]
  ): void {
    if (value === undefined || isActionInputReference(value)) {
      return;
    }
    if (inputType !== 'json') {
      const valueType = typeof value === 'object' ? 'json' : typeof value;
      if (valueType !== inputType) {
        const renderedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        throw new BuildConfigError(
          `Action "${ref}" input "${inputName}" must be of type "${inputType}" but got ${renderedValue}.`
        );
      }
    }
    const valueJson =
      typeof value === 'object' && value !== null ? JSON.stringify(value) : undefined;
    if (
      allowedValues !== undefined &&
      !allowedValues.some(allowedValue =>
        valueJson !== undefined
          ? JSON.stringify(allowedValue) === valueJson
          : Object.is(value, allowedValue)
      )
    ) {
      throw new BuildConfigError(
        `Action "${ref}" input "${inputName}" must be one of: ${allowedValues
          .map(allowedValue => JSON.stringify(allowedValue))
          .join(', ')}.`
      );
    }
  }

  private maybeCreateActionOutputsStep(
    action: ActionConfig,
    {
      syntheticStepId,
      actionDisplayName,
      interpolator,
      env,
      ifCondition,
      workingDirectory,
    }: {
      syntheticStepId: string;
      actionDisplayName: string;
      interpolator: ActionInputInterpolator;
      env?: BuildStepEnv;
      ifCondition?: string;
      workingDirectory?: string;
    }
  ): BuildStep | undefined {
    const outputEntries = Object.entries(action.outputs ?? {});
    if (outputEntries.length === 0) {
      return undefined;
    }

    const outputTemplates = outputEntries.map(([name, output]) => ({
      name,
      template: interpolator.interpolateString(output.value),
    }));

    const outputs = outputEntries.map(
      ([name]) =>
        new BuildStepOutput(this.ctx, {
          id: name,
          stepDisplayName: actionDisplayName,
          required: true,
        })
    );

    return new BuildStep(this.ctx, {
      id: syntheticStepId,
      displayName: actionDisplayName,
      fn: (stepCtx, { outputs: outputById, env: stepEnv }) => {
        for (const { name, template } of outputTemplates) {
          outputById[name].set(resolveActionOutputTemplate(template, stepCtx, stepEnv));
        }
      },
      outputs,
      env,
      ifCondition,
      workingDirectory,
    });
  }
}
