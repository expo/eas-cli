/**
 * Runtime scope for one expanded action call.
 *
 * Actions are flattened into the workflow, but inner steps still need action-local semantics:
 * `${{ steps.read }}` must mean the inner `read` step, not a workflow step with the same id.
 * This class overlays a short-id `steps` view on top of the global interpolation context,
 * and tracks failures within the action for scoped `success()` / `failure()`.
 */
import { JobInterpolationContext } from '@expo/eas-build-job';

import { BuildStepEnv } from './BuildStepEnv';

export type EvaluateScopedIfCondition = (
  ifCondition: string | undefined,
  scope: BuildStepActionScope
) => boolean;

export class BuildStepActionScope {
  public readonly parent?: BuildStepActionScope;
  public readonly env?: BuildStepEnv;
  private readonly ifCondition?: string;
  private readonly stepIdAliases?: Map<string, string>;
  private _hasFailedStep = false;
  private cachedIsActive?: boolean;

  constructor({
    parent,
    ifCondition,
    env,
    stepIdAliases,
  }: {
    parent?: BuildStepActionScope;
    ifCondition?: string;
    env?: BuildStepEnv;
    stepIdAliases?: Map<string, string>;
  }) {
    this.parent = parent;
    this.ifCondition = ifCondition;
    this.env = env;
    this.stepIdAliases = stepIdAliases;
  }

  public get hasFailedStep(): boolean {
    return this._hasFailedStep;
  }

  /** Bubbles up so nested actions and the caller's `failure()` see inner step failures. */
  public markStepFailed(): void {
    this._hasFailedStep = true;
    this.parent?.markStepFailed();
  }

  /** Walks the parent chain; the call-site `if` gates the whole action, not individual inner steps. */
  public isActive(evaluate: EvaluateScopedIfCondition): boolean {
    if (this.parent && !this.parent.isActive(evaluate)) {
      return false;
    }
    this.cachedIsActive ??= evaluate(this.ifCondition, this);
    return this.cachedIsActive;
  }

  public resolveStepId(shortId: string): string | undefined {
    return this.stepIdAliases?.get(shortId);
  }

  public getScopedInterpolationContext(base: JobInterpolationContext): JobInterpolationContext {
    if (!this.stepIdAliases) {
      return base;
    }
    return {
      ...base,
      steps: this.buildStepsView(base),
    };
  }

  private buildStepsView(base: JobInterpolationContext): JobInterpolationContext['steps'] {
    const view: JobInterpolationContext['steps'] = {};
    for (const [shortId, prefixedId] of this.stepIdAliases ?? []) {
      const step = base.steps?.[prefixedId];
      if (step !== undefined) {
        view[shortId] = step;
      }
    }
    return view;
  }
}
