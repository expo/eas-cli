/**
 * Runtime scope for one expanded composite function call.
 *
 * Composite functions are flattened into the workflow, but inner steps still need composite-function-local semantics:
 * `${{ steps.read }}` must mean the inner `read` step, not a workflow step with the same id.
 * This class overlays a `steps` view built from the call's own children on top of the global interpolation context.
 * success()/failure() use global workflow status (GitHub composite action parity).
 */
import { JobInterpolationContext } from '@expo/eas-build-job';

import type { BuildStepOutputAccessor, ShouldRunByDefault } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepEnv } from './BuildStepEnv';
import { BuildStepInput } from './BuildStepInput';
import { BuildStepRuntimeError } from './errors';
import {
  resolveInterpolatedTarget,
  stringifyInterpolatedResult,
} from './utils/compositeFunctionInterpolation';

export type EvaluateIfExpression = (
  expression: string,
  context: JobInterpolationContext
) => boolean;

type ScopedInterpolationContext = JobInterpolationContext & { inputs: Record<string, unknown> };

export class BuildStepCompositeFunctionScope {
  public readonly parent?: BuildStepCompositeFunctionScope;
  public readonly env?: BuildStepEnv;
  private readonly ctx: BuildStepGlobalContext;
  private readonly ifCondition?: string;
  private readonly compositeFunctionPath: string;
  private readonly inputs: Map<string, BuildStepInput>;
  private readonly providedInputKeys: ReadonlySet<string>;
  // Filled by the expander after construction; children and scope need each other.
  private readonly childrenByLocalId: Map<string, BuildStepOutputAccessor>;
  private cachedIsActive?: boolean;
  // Detects cycles while resolving input default values.
  private readonly resolvingInputs = new Set<string>();

  constructor({
    ctx,
    parent,
    ifCondition,
    env,
    compositeFunctionPath,
    inputs,
    providedInputKeys,
    childrenByLocalId,
  }: {
    ctx: BuildStepGlobalContext;
    parent?: BuildStepCompositeFunctionScope;
    ifCondition?: string;
    env?: BuildStepEnv;
    compositeFunctionPath: string;
    inputs: Map<string, BuildStepInput>;
    providedInputKeys: ReadonlySet<string>;
    childrenByLocalId: Map<string, BuildStepOutputAccessor>;
  }) {
    this.ctx = ctx;
    this.parent = parent;
    this.ifCondition = ifCondition;
    this.env = env;
    this.compositeFunctionPath = compositeFunctionPath;
    this.inputs = inputs;
    this.providedInputKeys = providedInputKeys;
    this.childrenByLocalId = childrenByLocalId;
  }

  /**
   * Walks the parent chain; the call-site `if` gates the whole composite function call, not individual inner steps.
   * Memoized: global status can change mid-expansion, and re-evaluating would flip a passed
   * success() gate and skip remaining always()/failure() inner steps.
   */
  public isActive(evaluate: EvaluateIfExpression, shouldRunByDefault: ShouldRunByDefault): boolean {
    if (this.parent && !this.parent.isActive(evaluate, shouldRunByDefault)) {
      return false;
    }
    this.cachedIsActive ??= this.evaluateCallIfCondition(evaluate, shouldRunByDefault);
    return this.cachedIsActive;
  }

  // Call-site if uses caller env/inputs/steps, not expanded inner steps.
  private evaluateCallIfCondition(
    evaluate: EvaluateIfExpression,
    shouldRunByDefault: ShouldRunByDefault
  ): boolean {
    if (!this.ifCondition) {
      return shouldRunByDefault();
    }
    const callerBase: JobInterpolationContext = {
      ...this.ctx.getInterpolationContext(),
      env: this.ctx.env,
    };
    const env = { ...this.ctx.env, ...this.resolveInheritedEnv(callerBase) };
    const baseContext = this.ctx.getIfConditionContext({
      inputs: {},
      env,
    }) as JobInterpolationContext;
    const context = this.parent
      ? this.parent.getScopedInterpolationContext(baseContext)
      : baseContext;
    return evaluate(this.ifCondition, context);
  }

  public getScopedInterpolationContext(base: JobInterpolationContext): JobInterpolationContext {
    // Spread `base` into a new object; never spread the returned context, as that would eagerly
    // resolve every lazy input getter.
    const scoped: ScopedInterpolationContext = {
      ...base,
      steps: this.buildStepsView(),
      inputs: this.buildInputsObject(base),
    };
    return scoped;
  }

  /** Caller scope for `with:` values and call-site env. */
  public getCallerInterpolationContext(base: JobInterpolationContext): JobInterpolationContext {
    return this.parent ? this.parent.getScopedInterpolationContext(base) : base;
  }

  public resolveScopeEnv(base: JobInterpolationContext): BuildStepEnv {
    if (!this.env) {
      return {};
    }
    const callerContext = this.getCallerInterpolationContext(base);
    return Object.fromEntries(
      Object.entries(this.env).map(([key, value]) => [
        key,
        stringifyInterpolatedResult(resolveInterpolatedTarget(value, callerContext)),
      ])
    );
  }

  /** Merge call-site env from each scope level, outer to inner; inner keys win. */
  public resolveInheritedEnv(base: JobInterpolationContext): BuildStepEnv {
    const parentEnv = this.parent?.resolveInheritedEnv(base) ?? {};
    return { ...parentEnv, ...this.resolveScopeEnv(base) };
  }

  // Workflow hides prefixed ids; re-expose the call's children under their local ids.
  private buildStepsView(): JobInterpolationContext['steps'] {
    const view: JobInterpolationContext['steps'] = {};
    for (const [localId, child] of this.childrenByLocalId) {
      view[localId] = {
        outputs: Object.fromEntries(child.outputs.map(output => [output.id, output.rawValue])),
      };
    }
    return view;
  }

  private buildInputsObject(base: JobInterpolationContext): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    for (const [name, input] of this.inputs) {
      Object.defineProperty(inputs, name, {
        enumerable: true,
        configurable: true,
        get: () => this.resolveInputValue(name, input, base),
      });
    }
    return inputs;
  }

  private resolveInputValue(
    name: string,
    input: BuildStepInput,
    base: JobInterpolationContext
  ): unknown {
    if (this.resolvingInputs.has(name)) {
      throw new BuildStepRuntimeError(
        `Composite function "${this.compositeFunctionPath}" input "${name}" references itself, directly or indirectly, through its default value.`
      );
    }
    this.resolvingInputs.add(name);
    try {
      const isProvided = this.providedInputKeys.has(name);
      // Env binds at the call boundary so inner step `env:` overrides do not leak into inputs.
      const boundBase: JobInterpolationContext = {
        ...base,
        env: this.resolveCompositeFunctionBoundaryEnv(base),
      };
      // Caller-provided values resolve in the caller's scope; defaults resolve in this composite function's.
      const interpolationContext = isProvided
        ? this.getCallerInterpolationContext(boundBase)
        : this.getScopedInterpolationContext(boundBase);
      return input.getValue({ interpolationContext, skipLegacyOutputInterpolation: true });
    } finally {
      this.resolvingInputs.delete(name);
    }
  }

  // Global + inherited call-site env; inputs ignore inner overrides.
  public resolveCompositeFunctionBoundaryEnv(base: JobInterpolationContext): BuildStepEnv {
    const boundaryBase: JobInterpolationContext = { ...base, env: this.ctx.env };
    return { ...this.ctx.env, ...this.resolveInheritedEnv(boundaryBase) };
  }
}
