import { BuildFunctionById } from './BuildFunction';
import { BuildStep } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import { StepMetricResult } from './StepMetrics';

export class BuildWorkflow {
  public readonly buildSteps: BuildStep[];
  public readonly buildFunctions: BuildFunctionById;

  constructor(
    private readonly ctx: BuildStepGlobalContext,
    { buildSteps, buildFunctions }: { buildSteps: BuildStep[]; buildFunctions: BuildFunctionById }
  ) {
    this.buildSteps = buildSteps;
    this.buildFunctions = buildFunctions;
  }

  public async executeAsync(): Promise<void> {
    let maybeError: Error | null = null;
    for (const step of this.buildSteps) {
      let shouldExecuteStep = false;

      try {
        shouldExecuteStep = step.shouldExecuteStep();
      } catch (err: any) {
        step.ctx.logger.error({ err });
        step.ctx.logger.error(
          `Runner failed to evaluate if it should execute step "${step.displayName}", using step's if condition "${step.ifCondition}". This can be caused by trying to access non-existing object property. If you think this is a bug report it here: https://github.com/expo/eas-cli/issues.`
        );
        maybeError = maybeError ?? err;
        this.ctx.markAsFailed();
      }

      if (shouldExecuteStep) {
        const startTime = performance.now();
        let stepResult: StepMetricResult;
        try {
          await step.executeAsync();
          stepResult = 'success';
        } catch (err: any) {
          stepResult = 'failed';
          maybeError = maybeError ?? err;
          this.ctx.markAsFailed();
        } finally {
          this.collectStepMetrics(step, stepResult!, performance.now() - startTime);
        }
      } else {
        step.skip();
      }
    }

    if (maybeError) {
      throw maybeError;
    }
  }

  private collectStepMetrics(step: BuildStep, result: StepMetricResult, durationMs: number): void {
    if (!step.__metricsId) {
      return;
    }

    this.ctx.addStepMetric({
      metricsId: step.__metricsId,
      result,
      durationMs,
    });
  }
}
