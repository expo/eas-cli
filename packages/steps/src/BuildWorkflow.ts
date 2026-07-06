import { BuildFunctionById } from './BuildFunction';
import { BuildRuntimePlatform } from './BuildRuntimePlatform';
import { BuildStep } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import { StepMetricResult } from './StepMetrics';
import {
  AnchorHooks,
  executeHookStepsAsync,
  logConditionEvaluationError,
  skipHookEntries,
} from './hooks';

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
      if (hooks !== undefined) {
        orderedSteps.push(...hooks.before.flatMap(entry => entry.steps));
      }
      orderedSteps.push(step);
      if (hooks !== undefined) {
        orderedSteps.push(...hooks.after.flatMap(entry => entry.steps));
      }
    }
    return orderedSteps;
  }

  public async executeAsync(): Promise<void> {
    // Failure is an explicit boolean pair, never the truthiness of the error
    // value: `throw undefined` is legal JS and must fail the job too.
    let hasFailed = false;
    let firstError: unknown;
    const recordFailure = (err: unknown): void => {
      if (!hasFailed) {
        hasFailed = true;
        firstError = err;
      }
    };

    for (const step of this.buildSteps) {
      const hooks = this.hooksByAnchorStep.get(step);
      // Captured BEFORE the gate: hooks of an anchor that runs past a
      // pre-existing failure (via `always()`) must default-run too.
      const baselineFailure = this.ctx.hasAnyPreviousStepFailed;

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
        this.ctx.markAsFailed();
      }

      if (!shouldExecuteStep) {
        step.skip();
        if (hooks !== undefined) {
          skipHookEntries(hooks.before);
          skipHookEntries(hooks.after);
        }
        continue;
      }

      if (hooks !== undefined) {
        const before = await executeHookStepsAsync(this.ctx, hooks.before, {
          anchor: hooks.anchor,
          timing: 'before',
          baselineFailure,
        });
        if (before.failedLocally) {
          recordFailure(before.firstError);
          step.skip();
          skipHookEntries(hooks.after);
          continue;
        }
      }

      // LOCAL anchor outcome — distinct from the global failure flag, which
      // may have been true all along when the anchor ran via `always()`.
      let anchorFailed = false;
      const startTime = performance.now();
      let stepResult: StepMetricResult;
      try {
        await step.executeAsync();
        stepResult = 'success';
      } catch (err: any) {
        stepResult = 'failed';
        anchorFailed = true;
        recordFailure(err);
        this.ctx.markAsFailed();
      } finally {
        this.ctx.collectStepMetric(step, stepResult!, performance.now() - startTime);
      }

      if (hooks !== undefined) {
        const after = await executeHookStepsAsync(this.ctx, hooks.after, {
          anchor: hooks.anchor,
          timing: 'after',
          anchorResult: anchorFailed ? 'failed' : 'success',
        });
        // A green anchor with a failed after-hook fails the job; a failed
        // anchor's error outranks the hook's.
        if (after.failedLocally) {
          recordFailure(after.firstError);
        }
      }
    }

    if (hasFailed) {
      throw firstError;
    }
  }
}
