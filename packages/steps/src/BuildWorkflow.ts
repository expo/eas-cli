import { HookAnchorId } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';

import { BuildFunctionById } from './BuildFunction';
import { BuildRuntimePlatform } from './BuildRuntimePlatform';
import { BuildStep } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import { StepMetricResult } from './StepMetrics';
import { AnchorHooks, HookEntry } from './hooks';
import { evaluateIfCondition } from './utils/jsepEval';

export class BuildWorkflow {
  public readonly buildSteps: BuildStep[];
  public readonly buildFunctions: BuildFunctionById;
  // Hook steps do NOT join buildSteps; they execute around their anchor step
  // below, keyed by anchor BuildStep instance so each occurrence carries its
  // own per-occurrence hook entries.
  public readonly hooksByAnchorStep: ReadonlyMap<BuildStep, AnchorHooks>;

  constructor(
    private readonly ctx: BuildStepGlobalContext,
    {
      buildSteps,
      buildFunctions,
      hooksByAnchorStep,
    }: {
      buildSteps: BuildStep[];
      buildFunctions: BuildFunctionById;
      hooksByAnchorStep?: ReadonlyMap<BuildStep, AnchorHooks>;
    }
  ) {
    this.buildSteps = buildSteps;
    this.buildFunctions = buildFunctions;
    this.hooksByAnchorStep = hooksByAnchorStep ?? new Map();
  }

  public get runtimePlatform(): BuildRuntimePlatform {
    return this.ctx.runtimePlatform;
  }

  /**
   * All steps in execution order: before-hooks → anchor → after-hooks per
   * occurrence. This is the validation view; execution itself walks
   * `buildSteps` and expands hooks around each anchor.
   */
  public getExecutionOrderedSteps(): BuildStep[] {
    const orderedSteps: BuildStep[] = [];
    for (const step of this.buildSteps) {
      const hooks = this.hooksByAnchorStep.get(step);
      orderedSteps.push(
        ...(hooks?.before ?? []).flatMap(entry => entry.steps),
        step,
        ...(hooks?.after ?? []).flatMap(entry => entry.steps)
      );
    }
    return orderedSteps;
  }

  public async executeAsync(): Promise<void> {
    // Boolean, not error truthiness — gate-evaluation throws bypass
    // BuildStep's non-Error normalization.
    let hasFailed = false;
    let firstError: unknown;
    const recordFailure = (err: unknown): void => {
      if (!hasFailed) {
        hasFailed = true;
        firstError = err;
      }
      this.ctx.markAsFailed();
    };

    for (const step of this.buildSteps) {
      const hooks = this.hooksByAnchorStep.get(step);

      // The anchor's gate is evaluated ONCE and decides for the whole
      // occurrence; an anchor's `if:` cannot see its before-hooks' outputs.
      let shouldExecuteStep = false;
      try {
        shouldExecuteStep = step.shouldExecuteStep();
      } catch (err: any) {
        logConditionEvaluationError(
          step.ctx.logger,
          err,
          `step "${step.displayName}"`,
          step.ifCondition
        );
        recordFailure(err);
      }

      if (!shouldExecuteStep) {
        step.skip();
        for (const entry of [...(hooks?.before ?? []), ...(hooks?.after ?? [])]) {
          for (const hookStep of entry.steps) {
            hookStep.skip();
          }
        }
        continue;
      }

      const before = await this.executeHookSideAsync(hooks, 'before');
      if (before.failedLocally) {
        recordFailure(before.firstError);
        step.skip();
        for (const entry of hooks?.after ?? []) {
          for (const hookStep of entry.steps) {
            hookStep.skip();
          }
        }
        continue;
      }

      // LOCAL outcome, not the global flag.
      let anchorFailed = false;
      const startTime = performance.now();
      let stepResult: StepMetricResult = 'success';
      try {
        await step.executeAsync();
      } catch (err: any) {
        stepResult = 'failed';
        anchorFailed = true;
        recordFailure(err);
      } finally {
        this.ctx.collectStepMetric(step, stepResult, performance.now() - startTime);
      }

      const after = await this.executeHookSideAsync(
        hooks,
        'after',
        anchorFailed ? 'failed' : 'success'
      );
      if (after.failedLocally) {
        recordFailure(after.firstError);
      }
    }

    if (hasFailed) {
      throw firstError;
    }
  }

  private async executeHookSideAsync(
    hooks: AnchorHooks | undefined,
    timing: 'before' | 'after',
    anchorResult?: StepMetricResult
  ): Promise<{ failedLocally: boolean; firstError: unknown }> {
    if (hooks === undefined) {
      return { failedLocally: false, firstError: undefined };
    }
    return await executeHookStepsAsync(this.ctx, hooks[timing], {
      anchor: hooks.anchor,
      timing,
      anchorResult,
    });
  }
}

/**
 * Executes hook entries around an anchor: the engine-public execution
 * primitive. Catches condition-evaluation errors AND execution errors, marks
 * global failure, preserves the FIRST local error, and reports ONE
 * `WorkflowHookMetric` per executed hook side.
 *
 * Default-run rules (a step or entry with no `if:`):
 * - `before`: runs unless a failure occurred within THIS hook sequence;
 *   failures predating the call are ignored — "runs iff the anchor runs".
 * - `after`: runs unconditionally — past the anchor's own failure AND past an
 *   earlier after-entry's failure.
 * Passed as `shouldRunByDefault` so composite scopes share the same missing-`if:` rule.
 * A user `if:` is always evaluated against the real global context, so
 * `failure()` / `success()` keep their global meaning on both sides.
 */
export async function executeHookStepsAsync(
  ctx: BuildStepGlobalContext,
  entries: HookEntry[],
  options: {
    anchor: HookAnchorId;
    timing: 'before' | 'after';
    /** The anchor's LOCAL outcome; set by the caller on after-timing calls. */
    anchorResult?: StepMetricResult;
  }
): Promise<{ failedLocally: boolean; firstError: unknown }> {
  let failedLocally = false;
  let firstError: unknown;
  const recordFailure = (err: unknown): void => {
    if (!failedLocally) {
      failedLocally = true;
      firstError = err;
    }
    ctx.markAsFailed();
  };

  let anyStepExecuted = false;
  for (const entry of entries) {
    // Truthiness, not presence: an empty `if:` means "no condition", the same
    // as BuildStep.shouldExecuteStep treats it.
    const entryHasExplicitCondition = Boolean(entry.ifCondition);
    if (entry.ifCondition) {
      let entryEligible = false;
      try {
        entryEligible = evaluateIfCondition(
          entry.ifCondition,
          // A group entry has no step to hang the authored condition on, so
          // its `if:` gets the shared context with no step inputs.
          ctx.getIfConditionContext({ inputs: {}, env: ctx.env })
        );
      } catch (err) {
        logConditionEvaluationError(
          entry.steps[0]?.ctx.logger ?? ctx.baseLogger,
          err,
          'the hook group step',
          entry.ifCondition
        );
        recordFailure(err);
      }
      if (!entryEligible) {
        for (const step of entry.steps) {
          step.skip();
        }
        continue;
      }
    }

    let entryFailed = false;
    // Live over entryFailed/failedLocally: before skips on in-sequence failure;
    // entry with a passed if: only skips on within-entry failure; after always runs.
    const shouldRunByDefault = (): boolean =>
      options.timing === 'after' || (entryHasExplicitCondition ? !entryFailed : !failedLocally);
    for (const step of entry.steps) {
      let shouldExecuteStep = false;
      try {
        shouldExecuteStep = step.shouldExecuteStep(shouldRunByDefault);
      } catch (err) {
        logConditionEvaluationError(
          step.ctx.logger,
          err,
          `step "${step.displayName}"`,
          step.ifCondition
        );
        recordFailure(err);
        entryFailed = true;
      }
      if (!shouldExecuteStep) {
        step.skip();
        continue;
      }
      anyStepExecuted = true;
      const startTime = performance.now();
      let stepResult: StepMetricResult = 'success';
      try {
        await step.executeAsync();
      } catch (err) {
        stepResult = 'failed';
        entryFailed = true;
        recordFailure(err);
      } finally {
        ctx.collectStepMetric(step, stepResult, performance.now() - startTime);
      }
    }
  }

  if (anyStepExecuted) {
    ctx.reportWorkflowHookMetric({
      anchor: options.anchor,
      timing: options.timing,
      result: failedLocally ? 'failed' : 'success',
      ...(options.anchorResult !== undefined ? { anchorResult: options.anchorResult } : null),
    });
  }

  return { failedLocally, firstError };
}

// Shared wording for unevaluable `if:` gates. `ifCondition` is omitted when the
// failure is a composite call-site `if:` evaluated via the step's scope.
function logConditionEvaluationError(
  logger: bunyan,
  err: unknown,
  subject: string,
  ifCondition: string | undefined
): void {
  logger.error({ err });
  logger.error(
    `Runner failed to evaluate if it should execute ${subject}${
      ifCondition ? `, using its if condition "${ifCondition}"` : ''
    }. This can be caused by trying to access non-existing object property. If you think this is a bug report it here: https://github.com/expo/eas-cli/issues.`
  );
}
