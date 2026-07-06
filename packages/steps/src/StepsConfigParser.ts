import {
  FunctionStep,
  HOOK_ANCHOR_ID_BY_FUNCTION_ID,
  HookAnchorId,
  Hooks,
  ShellStep,
  Step,
  isHookAnchorId,
  isStepFunctionStep,
  isStepShellStep,
  parseHookKey,
  validateSteps,
} from '@expo/eas-build-job';
import assert from 'node:assert';

import { AbstractConfigParser } from './AbstractConfigParser';
import { BuildFunction, BuildFunctionById } from './BuildFunction';
import {
  BuildFunctionGroup,
  BuildFunctionGroupById,
  createBuildFunctionGroupByIdMapping,
} from './BuildFunctionGroup';
import { BuildStep } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepOutput } from './BuildStepOutput';
import { BuildConfigError } from './errors';

export class StepsConfigParser extends AbstractConfigParser {
  private readonly steps: Step[];
  private readonly hooks: Hooks;
  // Anchors present in the job's own steps, collected during insertion. Used
  // to warn about payload hook keys whose anchor never occurred.
  private readonly encounteredHookAnchors = new Set<HookAnchorId>();

  constructor(
    ctx: BuildStepGlobalContext,
    {
      steps,
      hooks,
      externalFunctions,
      externalFunctionGroups,
    }: {
      steps: Step[];
      // Required (not `hooks?:`) so a call site cannot silently forget to pass
      // the job's hooks — forgetting drops them without a trace.
      hooks: Hooks | undefined;
      externalFunctions?: BuildFunction[];
      externalFunctionGroups?: BuildFunctionGroup[];
    }
  ) {
    super(ctx, {
      externalFunctions,
      externalFunctionGroups,
    });

    this.steps = steps;
    this.hooks = hooks ?? {};
  }

  protected async parseConfigToBuildStepsAndBuildFunctionByIdMappingAsync(): Promise<{
    buildSteps: BuildStep[];
    buildFunctionById: BuildFunctionById;
  }> {
    const validatedSteps = validateSteps(this.steps);
    const validatedHooks = this.validateHooks();
    // Hook steps are validated like job steps: a hook `uses:` naming an
    // unknown function must be a BuildConfigError, not an assertion crash.
    StepsConfigParser.validateAllFunctionsExist(
      [...validatedSteps, ...Object.values(validatedHooks).flat()],
      {
        externalFunctionIds: this.getExternalFunctionFullIds(),
        externalFunctionGroupIds: this.getExternalFunctionGroupFullIds(),
      }
    );

    const buildFunctionById = this.createBuildFunctionByIdMappingForExternalFunctions();
    const buildFunctionGroupById = createBuildFunctionGroupByIdMapping(
      this.externalFunctionGroups ?? []
    );

    // Splices hook steps around anchor occurrences in the job's own steps.
    // Only the job's own steps are scanned — steps inserted from hooks are
    // never treated as anchors (no nesting). Unknown hook keys and
    // unregistered stamp values are inert (a worker must never fail on
    // anchors newer than itself).
    const buildSteps: BuildStep[] = [];
    // Last-seen before-side BuildStep per anchor, so a split stamp pair's
    // after side gates on the before side (the after-side step may carry an
    // `if:` and self-skip; the after hooks must still fire).
    const gateBuildStepByAnchor: Partial<Record<HookAnchorId, BuildStep>> = {};

    for (const stepConfig of validatedSteps) {
      const { beforeAnchor, afterAnchor } = StepsConfigParser.resolveStepAnchors(stepConfig);
      if (beforeAnchor !== undefined) {
        this.encounteredHookAnchors.add(beforeAnchor);
        for (const hookStep of this.getHookSteps(validatedHooks, 'before', beforeAnchor)) {
          buildSteps.push(
            ...this.createBuildStepsFromStepConfig(hookStep, {
              buildFunctionById,
              buildFunctionGroupById,
              hooksToInsert: undefined,
            })
          );
        }
      }
      const stepsForConfig = this.createBuildStepsFromStepConfig(stepConfig, {
        buildFunctionById,
        buildFunctionGroupById,
        hooksToInsert: validatedHooks,
      });
      buildSteps.push(...stepsForConfig);
      if (beforeAnchor !== undefined) {
        gateBuildStepByAnchor[beforeAnchor] = stepsForConfig[0];
      }
      if (afterAnchor !== undefined) {
        this.encounteredHookAnchors.add(afterAnchor);
        const runAfterStep = gateBuildStepByAnchor[afterAnchor] ?? stepsForConfig[0];
        for (const hookStep of this.getHookSteps(validatedHooks, 'after', afterAnchor)) {
          buildSteps.push(
            ...this.createBuildStepsFromStepConfig(hookStep, {
              buildFunctionById,
              buildFunctionGroupById,
              runAfterStep,
              hooksToInsert: undefined,
            })
          );
        }
        delete gateBuildStepByAnchor[afterAnchor];
      }
    }

    // After construction: group expansions also record encountered anchors.
    this.warnAboutUnmatchedHookKeys();

    return {
      buildSteps,
      buildFunctionById,
    };
  }

  private validateHooks(): Record<string, Step[]> {
    const validatedHooks: Record<string, Step[]> = {};
    for (const [hookKey, hookSteps] of Object.entries(this.hooks)) {
      // Keys that don't name a registered anchor are fully inert — never
      // validated, never inserted, reported by warnAboutUnmatchedHookKeys. A
      // worker must not fail on hook keys newer than itself, even when their
      // steps reference functions it doesn't have yet.
      if (parseHookKey(hookKey) === null) {
        continue;
      }
      // An empty array is a deliberate no-op (e.g. opting out of a default);
      // any other non-step-array shape falls through to validateSteps below so
      // it errors instead of being dropped silently.
      if (Array.isArray(hookSteps) && hookSteps.length === 0) {
        continue;
      }
      try {
        validatedHooks[hookKey] = validateSteps(hookSteps);
      } catch (err) {
        throw new BuildConfigError(
          `Invalid steps in "hooks.${hookKey}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return validatedHooks;
  }

  private static resolveStepAnchors(step: Step): {
    beforeAnchor?: HookAnchorId;
    afterAnchor?: HookAnchorId;
  } {
    if (isStepFunctionStep(step)) {
      // Function steps bind to anchors through the registry; stamps exist only
      // on shell steps (the schema strips them from function steps).
      const anchorId = HOOK_ANCHOR_ID_BY_FUNCTION_ID[step.uses];
      return { beforeAnchor: anchorId, afterAnchor: anchorId };
    }
    const hookId = step.__hook_id;
    if (
      hookId !== undefined &&
      (step.__hook_before_id !== undefined || step.__hook_after_id !== undefined)
    ) {
      throw new BuildConfigError(
        'A step cannot combine "__hook_id" with "__hook_before_id" or "__hook_after_id".'
      );
    }
    return {
      beforeAnchor: StepsConfigParser.toRegisteredAnchorId(hookId ?? step.__hook_before_id),
      afterAnchor: StepsConfigParser.toRegisteredAnchorId(hookId ?? step.__hook_after_id),
    };
  }

  private static toRegisteredAnchorId(value: string | undefined): HookAnchorId | undefined {
    return value !== undefined && isHookAnchorId(value) ? value : undefined;
  }

  /**
   * Returns the hook steps for one side of an anchor occurrence, logging the
   * insertion. The structured log line doubles as the observability signal for
   * silent hook drops (e.g. after a worker rollback) — do not remove it.
   */
  private getHookSteps(
    hooks: Record<string, Step[]>,
    side: 'before' | 'after',
    anchorId: HookAnchorId
  ): Step[] {
    const hookKey = `${side}_${anchorId}`;
    const hookSteps = hooks[hookKey] ?? [];
    if (hookSteps.length > 0) {
      this.ctx.baseLogger.info(
        { hookKey, hookAnchor: anchorId, insertedHookSteps: hookSteps.length },
        `Inserting ${hookSteps.length} hook step(s) for anchor "${anchorId}" (${hookKey})`
      );
    }
    return hookSteps;
  }

  /**
   * Warns about payload hook keys that never matched: unknown keys and keys
   * whose anchor never occurred in this job's steps. Never throws — a worker
   * must stay inert on anchors newer than itself.
   */
  private warnAboutUnmatchedHookKeys(): void {
    for (const hookKey of Object.keys(this.hooks)) {
      const parsedHookKey = parseHookKey(hookKey);
      if (parsedHookKey === null) {
        this.ctx.baseLogger.warn(
          { hookKey },
          `Unknown hook key "${hookKey}" in the job payload; its steps did not run.`
        );
      } else if (!this.encounteredHookAnchors.has(parsedHookKey.anchorId)) {
        this.ctx.baseLogger.warn(
          { hookKey, hookAnchor: parsedHookKey.anchorId },
          `Hook key "${hookKey}" did not match any step in this job (anchor "${parsedHookKey.anchorId}" never occurred); its steps did not run.`
        );
      }
    }
  }

  /**
   * A `uses: eas/build`-style step expands directly into BuildStep[] — its
   * internal steps never exist at the Step[] level, so the Step[]-level
   * insertion pass never sees them. This second pass resolves each expanded
   * step's anchor through the registry reverse map by its originating function
   * and splices constructed hook steps around it.
   */
  private insertHookBuildStepsIntoExpandedGroup(
    expandedSteps: BuildStep[],
    {
      buildFunctionById,
      buildFunctionGroupById,
      hooksToInsert,
    }: {
      buildFunctionById: BuildFunctionById;
      buildFunctionGroupById: BuildFunctionGroupById;
      hooksToInsert: Record<string, Step[]>;
    }
  ): BuildStep[] {
    const result: BuildStep[] = [];
    for (const buildStep of expandedSteps) {
      const sourceFunctionId = buildStep.sourceFunction?.getFullId();
      const anchorId =
        sourceFunctionId !== undefined
          ? HOOK_ANCHOR_ID_BY_FUNCTION_ID[sourceFunctionId]
          : undefined;
      if (anchorId === undefined) {
        result.push(buildStep);
        continue;
      }
      this.encounteredHookAnchors.add(anchorId);
      for (const hookStep of this.getHookSteps(hooksToInsert, 'before', anchorId)) {
        result.push(
          ...this.createBuildStepsFromStepConfig(hookStep, {
            buildFunctionById,
            buildFunctionGroupById,
            hooksToInsert: undefined,
          })
        );
      }
      result.push(buildStep);
      for (const hookStep of this.getHookSteps(hooksToInsert, 'after', anchorId)) {
        result.push(
          ...this.createBuildStepsFromStepConfig(hookStep, {
            buildFunctionById,
            buildFunctionGroupById,
            runAfterStep: buildStep,
            hooksToInsert: undefined,
          })
        );
      }
    }
    return result;
  }

  private createBuildFunctionByIdMappingForExternalFunctions(): BuildFunctionById {
    const result: BuildFunctionById = {};

    if (this.externalFunctions === undefined) {
      return result;
    }

    for (const buildFunction of this.externalFunctions) {
      const fullId = buildFunction.getFullId();
      result[fullId] = buildFunction;
    }
    return result;
  }

  private createBuildStepsFromStepConfig(
    stepConfig: Step,
    {
      buildFunctionById,
      buildFunctionGroupById,
      runAfterStep,
      hooksToInsert,
    }: {
      buildFunctionById: BuildFunctionById;
      buildFunctionGroupById: BuildFunctionGroupById;
      runAfterStep?: BuildStep;
      // Hooks to insert into function-group expansions of this step, or
      // undefined when the step itself came from a hook (no nesting).
      hooksToInsert: Record<string, Step[]> | undefined;
    }
  ): BuildStep[] {
    if (isStepShellStep(stepConfig)) {
      return [this.createBuildStepFromShellStepConfig(stepConfig, { runAfterStep })];
    } else if (isStepFunctionStep(stepConfig)) {
      return this.createBuildStepsFromFunctionStepConfig(stepConfig, {
        buildFunctionById,
        buildFunctionGroupById,
        runAfterStep,
        hooksToInsert,
      });
    } else {
      throw new BuildConfigError(
        'Invalid job step configuration detected. Step must be shell or function step'
      );
    }
  }

  private createBuildStepFromShellStepConfig(
    step: ShellStep,
    { runAfterStep }: { runAfterStep?: BuildStep }
  ): BuildStep {
    const id = BuildStep.getNewId(step.id);
    const displayName =
      step.name ??
      step.id ??
      step.run
        .split('\n')
        .find(line => line.trim())
        ?.trim() ??
      step.run;
    const outputs =
      step.outputs && this.createBuildStepOutputsFromDefinition(step.outputs, displayName);
    return new BuildStep(this.ctx, {
      id,
      displayName,
      outputs,
      workingDirectory: step.working_directory,
      shell: step.shell,
      command: step.run,
      env: step.env,
      ifCondition: step.if,
      __metricsId: step.__metrics_id,
      runAfterStep,
    });
  }

  private createBuildStepsFromFunctionStepConfig(
    step: FunctionStep,
    {
      buildFunctionById,
      buildFunctionGroupById,
      runAfterStep,
      hooksToInsert,
    }: {
      buildFunctionById: BuildFunctionById;
      buildFunctionGroupById: BuildFunctionGroupById;
      runAfterStep?: BuildStep;
      hooksToInsert: Record<string, Step[]> | undefined;
    }
  ): BuildStep[] {
    const functionId = step.uses;
    const maybeFunctionGroup = buildFunctionGroupById[functionId];
    if (maybeFunctionGroup) {
      if (runAfterStep !== undefined) {
        // The group API has no per-step gate channel, so expanded steps would
        // run even when the anchor was skipped — breaking the "after_x runs
        // iff the anchor ran" invariant. Before hooks are unaffected (they use
        // the normal step gating).
        throw new BuildConfigError(
          `A function group ("${functionId}") cannot be used in an after hook because its steps cannot be gated on the hook's anchor step. Use "run:" or plain function steps instead.`
        );
      }
      // TODO: allow to set id, name, working_directory, shell, env and if for function groups
      const expandedSteps = maybeFunctionGroup.createBuildStepsFromFunctionGroupCall(this.ctx, {
        callInputs: step.with,
      });
      if (hooksToInsert === undefined) {
        return expandedSteps;
      }
      return this.insertHookBuildStepsIntoExpandedGroup(expandedSteps, {
        buildFunctionById,
        buildFunctionGroupById,
        hooksToInsert,
      });
    }

    const buildFunction = buildFunctionById[functionId];
    assert(buildFunction, 'function ID must be ID of function or function group');

    return [
      buildFunction.createBuildStepFromFunctionCall(this.ctx, {
        id: step.id,
        name: step.name,
        callInputs: step.with,
        workingDirectory: step.working_directory,
        shell: step.shell,
        env: step.env,
        ifCondition: step.if,
        runAfterStep,
      }),
    ];
  }

  private createBuildStepOutputsFromDefinition(
    stepOutputs: Required<ShellStep>['outputs'],
    stepDisplayName: string
  ): BuildStepOutput[] {
    return stepOutputs.map(
      entry =>
        new BuildStepOutput(this.ctx, {
          id: entry.name,
          stepDisplayName,
          required: entry.required ?? true,
        })
    );
  }

  private static validateAllFunctionsExist(
    steps: Step[],
    {
      externalFunctionIds,
      externalFunctionGroupIds,
    }: {
      externalFunctionIds: string[];
      externalFunctionGroupIds: string[];
    }
  ): void {
    const calledFunctionsOrFunctionGroupsSet = new Set<string>();
    for (const step of steps) {
      if (step.uses) {
        calledFunctionsOrFunctionGroupsSet.add(step.uses);
      }
    }
    const calledFunctionsOrFunctionGroup = Array.from(calledFunctionsOrFunctionGroupsSet);
    const externalFunctionIdsSet = new Set(externalFunctionIds);
    const externalFunctionGroupsIdsSet = new Set(externalFunctionGroupIds);
    const nonExistentFunctionsOrFunctionGroups = calledFunctionsOrFunctionGroup.filter(
      calledFunctionOrFunctionGroup => {
        return (
          !externalFunctionIdsSet.has(calledFunctionOrFunctionGroup) &&
          !externalFunctionGroupsIdsSet.has(calledFunctionOrFunctionGroup)
        );
      }
    );
    if (nonExistentFunctionsOrFunctionGroups.length > 0) {
      throw new BuildConfigError(
        `Calling non-existent functions: ${nonExistentFunctionsOrFunctionGroups
          .map(f => `"${f}"`)
          .join(', ')}.`
      );
    }
  }
}
