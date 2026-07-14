/**
 * Runtime scope for one expanded composite function call.
 *
 * Composite functions are flattened into the workflow, but inner steps still need composite-function-local semantics:
 * `${{ steps.read }}` must mean the inner `read` step, not a workflow step with the same id.
 * This class overlays a short-id `steps` view on top of the global interpolation context.
 * success()/failure() use global workflow status (GitHub composite action parity).
 */
import { JobInterpolationContext } from '@expo/eas-build-job';

import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepEnv } from './BuildStepEnv';

export type EvaluateIfExpression = (
  expression: string,
  context: JobInterpolationContext
) => boolean;

export class BuildStepCompositeFunctionScope {
  public readonly parent?: BuildStepCompositeFunctionScope;
  public readonly env?: BuildStepEnv;
  private readonly ctx: BuildStepGlobalContext;
  private readonly ifCondition?: string;
  private readonly stepIdAliases: Map<string, string>;
  private cachedIsActive?: boolean;

  constructor({
    ctx,
    parent,
    ifCondition,
    env,
    stepIdAliases,
  }: {
    ctx: BuildStepGlobalContext;
    parent?: BuildStepCompositeFunctionScope;
    ifCondition?: string;
    env?: BuildStepEnv;
    stepIdAliases: Map<string, string>;
  }) {
    this.ctx = ctx;
    this.parent = parent;
    this.ifCondition = ifCondition;
    this.env = env;
    this.stepIdAliases = stepIdAliases;
  }

  /**
   * Walks the parent chain; the call-site `if` gates the whole composite function call, not individual inner steps.
   * Memoized: global status can change mid-expansion, and re-evaluating would flip a passed
   * success() gate and skip remaining always()/failure() inner steps.
   */
  public isActive(evaluate: EvaluateIfExpression): boolean {
    if (this.parent && !this.parent.isActive(evaluate)) {
      return false;
    }
    this.cachedIsActive ??= this.evaluateCallIfCondition(evaluate);
    return this.cachedIsActive;
  }

  // Call-site if uses caller env/steps/status. Input interpolation and inherited env
  // template resolution are added when composite function inputs are wired up.
  private evaluateCallIfCondition(evaluate: EvaluateIfExpression): boolean {
    if (!this.ifCondition) {
      return !this.ctx.hasAnyPreviousStepFailed;
    }
    const env = { ...this.ctx.env, ...(this.env ?? {}) };
    const baseContext = this.ctx.getIfConditionContext({
      inputs: {},
      env,
    }) as JobInterpolationContext;
    const context = this.parent
      ? this.parent.getScopedInterpolationContext(baseContext)
      : baseContext;
    return evaluate(this.ifCondition, context);
  }

  public resolveStepId(shortId: string): string | undefined {
    return this.stepIdAliases.get(shortId);
  }

  public getScopedInterpolationContext(base: JobInterpolationContext): JobInterpolationContext {
    return {
      ...base,
      steps: this.buildStepsView(),
    };
  }

  // Workflow hides prefixed ids; re-expose them under short aliases.
  private buildStepsView(): JobInterpolationContext['steps'] {
    const fullSteps = this.ctx.getFullStepsInterpolationView();
    const view: JobInterpolationContext['steps'] = {};
    for (const [shortId, prefixedId] of this.stepIdAliases) {
      const step = fullSteps[prefixedId];
      if (step !== undefined) {
        view[shortId] = step;
      }
    }
    return view;
  }
}
