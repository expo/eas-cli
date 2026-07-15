/**
 * Expands local composite actions (`uses: ./path/to/action`) into concrete {@link BuildStep}s
 * at parse time.
 *
 * An action call is not executed as a single step. Its `runs.steps` are flattened into the
 * workflow with prefixed ids (`caller__inner`) so the existing step runner can execute them.
 * Each expanded step carries a {@link BuildStepActionScope} so `${{ steps.* }}` and
 * `${{ inputs.* }}` inside the action resolve against action-local names, not global ones.
 */
import {
  ActionCatalog,
  ActionConfig,
  FunctionStep,
  ShellStep,
  Step,
  isStepFunctionStep,
  isStepShellStep,
} from '@expo/eas-build-job';

import { BuildFunctionById } from './BuildFunction';
import { BuildFunctionGroupById } from './BuildFunctionGroup';
import { BuildStep } from './BuildStep';
import { BuildStepActionScope } from './BuildStepActionScope';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepEnv } from './BuildStepEnv';
import { BuildConfigError } from './errors';
import { duplicates } from './utils/expodash/duplicates';
import { isActionPath, parseActionPath } from './utils/localActions';
import { createBuildStepOutputsFromDefinition, getShellStepDisplayName } from './utils/step';

const MAX_ACTION_NESTING_DEPTH = 10;

export type FunctionMaps = {
  buildFunctionById: BuildFunctionById;
  buildFunctionGroupById: BuildFunctionGroupById;
};

type ActionCall = {
  actionPath: string;
  /** Caller-assigned id used as prefix for all inner step ids and the action outputs step. */
  syntheticStepId: string;
  /** Caller-provided input values, consumed when action inputs are interpolated. */
  callWith?: Record<string, unknown>;
  callIf?: string;
  parentScope?: BuildStepActionScope;
  inheritedEnv?: BuildStepEnv;
  inheritedWorkingDirectory?: string;
};

type InheritedStepOverrides = { env?: BuildStepEnv; workingDirectory?: string };

type StepOverrides = InheritedStepOverrides & { ifCondition?: string };

export class ActionExpander {
  constructor(
    private readonly ctx: BuildStepGlobalContext,
    private readonly actionCatalog: ActionCatalog,
    private readonly functionMaps: FunctionMaps
  ) {}

  public expandActionStep(
    step: FunctionStep,
    actionPath: string,
    syntheticStepId: string
  ): BuildStep[] {
    return this.expand(
      {
        actionPath,
        syntheticStepId,
        callWith: step.with,
        callIf: step.if,
        inheritedEnv: step.env,
        inheritedWorkingDirectory: step.working_directory,
      },
      new Set<string>()
    );
  }

  // `visited.size` is the current action nesting depth.
  private expand(call: ActionCall, visited: ReadonlySet<string>): BuildStep[] {
    const { actionPath, syntheticStepId } = call;
    this.guardAgainstRunawayRecursion(actionPath, visited);

    const action = this.lookupAction(actionPath);
    const innerSteps = action.runs.steps;

    const { stepIdMap, newIds } = this.buildInnerStepIdMap(innerSteps, syntheticStepId, actionPath);

    const nestedVisited = new Set(visited).add(actionPath);

    const scope = new BuildStepActionScope({
      parent: call.parentScope,
      ifCondition: call.callIf,
      env: call.inheritedEnv,
      stepIdAliases: stepIdMap,
    });

    const buildSteps = innerSteps.flatMap((innerStep, index) =>
      this.expandInnerStep(innerStep, newIds[index], {
        actionPath,
        scope,
        inherited: {
          env: call.inheritedEnv,
          workingDirectory: call.inheritedWorkingDirectory,
        },
        nestedVisited,
      })
    );

    return buildSteps;
  }

  private guardAgainstRunawayRecursion(actionPath: string, visited: ReadonlySet<string>): void {
    if (visited.has(actionPath)) {
      const cyclePath = [...visited, actionPath].join(' -> ');
      throw new BuildConfigError(
        `Detected a cycle while expanding actions: ${cyclePath}. An action cannot reference itself, directly or indirectly.`
      );
    }
    if (visited.size >= MAX_ACTION_NESTING_DEPTH) {
      throw new BuildConfigError(
        `Maximum action nesting depth (${MAX_ACTION_NESTING_DEPTH}) exceeded while expanding action "${actionPath}".`
      );
    }
  }

  private lookupAction(actionPath: string): ActionConfig {
    const action = this.actionCatalog[actionPath];
    if (!action) {
      throw new BuildConfigError(
        `Local action "${actionPath}" does not exist. Expected an "action.yml" (or "action.yaml") file at "${actionPath}" relative to the EAS project root (convention: ".eas/actions/<name>").`
      );
    }
    return action;
  }

  private expandInnerStep(
    innerStep: Step,
    newId: string,
    {
      actionPath,
      scope,
      inherited,
      nestedVisited,
    }: {
      actionPath: string;
      scope: BuildStepActionScope;
      inherited: InheritedStepOverrides;
      nestedVisited: ReadonlySet<string>;
    }
  ): BuildStep[] {
    const overrides = this.resolveStepOverrides(innerStep, inherited);

    if (isStepFunctionStep(innerStep)) {
      if (isActionPath(innerStep.uses)) {
        return this.expandNestedActionCall(innerStep, {
          actionPath: parseActionPath(innerStep.uses),
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
        actionPath: actionPath,
      });
    }
    if (isStepShellStep(innerStep)) {
      return [this.createExpandedShellStep(innerStep, { newId, overrides, scope })];
    }
    throw new BuildConfigError(
      `Invalid step configuration in action "${actionPath}". Step must be a shell or function step.`
    );
  }

  private resolveStepOverrides(innerStep: Step, inherited: InheritedStepOverrides): StepOverrides {
    const env = mergeEnv(inherited.env, innerStep.env);
    const ifCondition = innerStep.if;
    const workingDirectory =
      innerStep.working_directory !== undefined
        ? innerStep.working_directory
        : inherited.workingDirectory;
    return { env, ifCondition, workingDirectory };
  }

  private expandNestedActionCall(
    innerStep: FunctionStep,
    {
      actionPath,
      newId,
      overrides,
      scope,
      visited,
    }: {
      actionPath: string;
      newId: string;
      overrides: StepOverrides;
      scope: BuildStepActionScope;
      visited: ReadonlySet<string>;
    }
  ): BuildStep[] {
    return this.expand(
      {
        actionPath,
        syntheticStepId: newId,
        callWith: innerStep.with,
        callIf: overrides.ifCondition,
        parentScope: scope,
        inheritedEnv: overrides.env,
        inheritedWorkingDirectory: overrides.workingDirectory,
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
      scope: BuildStepActionScope;
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
      actionScope: scope,
      __metricsId: step.__metrics_id,
    });
  }

  private createExpandedFunctionSteps(
    step: FunctionStep,
    {
      newId,
      overrides,
      scope,
      actionPath,
    }: {
      newId: string;
      overrides: StepOverrides;
      scope: BuildStepActionScope;
      actionPath: string;
    }
  ): BuildStep[] {
    const functionId = step.uses;
    const { buildFunctionById, buildFunctionGroupById } = this.functionMaps;
    const maybeFunctionGroup = buildFunctionGroupById[functionId];
    if (maybeFunctionGroup) {
      throw new BuildConfigError(
        `Function group "${functionId}" cannot be used inside an action. Function groups expand to multiple steps with their own ids and do not support action-level id, env, if, or working_directory overrides. Use individual function steps instead.`
      );
    }

    const buildFunction = buildFunctionById[functionId];
    if (!buildFunction) {
      throw new BuildConfigError(
        `Action "${actionPath}" calls non-existent function "${functionId}".`
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
        actionScope: scope,
      }),
    ];
  }

  /**
   * Maps action-local step ids to globally unique ids and builds the alias table for scope.
   * Without namespacing, two action calls with inner step `read` would collide in the workflow.
   */
  private buildInnerStepIdMap(
    innerSteps: Step[],
    syntheticStepId: string,
    actionPath: string
  ): { stepIdMap: Map<string, string>; newIds: string[] } {
    const stepIdMap = new Map<string, string>();
    const newIds: string[] = [];
    const declaredIdList = innerSteps.map(step => step.id).filter((id): id is string => !!id);
    const duplicatedIds = duplicates(declaredIdList);
    if (duplicatedIds.length > 0) {
      throw new BuildConfigError(
        `Action "${actionPath}" declares duplicated step IDs: ${duplicatedIds
          .map(id => `"${id}"`)
          .join(', ')}. Step IDs within an action must be unique.`
      );
    }
    const declaredIds = new Set(declaredIdList);
    let generatedStepIdCounter = 0;
    for (const innerStep of innerSteps) {
      let sourceId = innerStep.id;
      if (!sourceId) {
        do {
          sourceId = `action_step_${++generatedStepIdCounter}`;
        } while (declaredIds.has(sourceId));
      }
      const newId = `${syntheticStepId}__${sourceId}`;
      stepIdMap.set(sourceId, newId);
      newIds.push(newId);
    }
    return { stepIdMap, newIds };
  }
}

function mergeEnv(base?: BuildStepEnv, overrides?: BuildStepEnv): BuildStepEnv | undefined {
  if (!base && !overrides) {
    return undefined;
  }
  return { ...base, ...overrides };
}
