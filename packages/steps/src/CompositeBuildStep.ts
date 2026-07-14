import { JobInterpolationContext } from '@expo/eas-build-job';

import { BuildStep, BuildStepFunction } from './BuildStep';
import { BuildStepCompositeFunctionScope } from './BuildStepCompositeFunctionScope';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepOutput } from './BuildStepOutput';
import {
  resolveInterpolatedTarget,
  stringifyInterpolatedResult,
} from './utils/compositeFunctionInterpolation';

/**
 * Parse-time node for one composite function call (`uses: ./...`).
 * Flattening contributes children (and this node only when it declares outputs);
 * when it runs, it resolves output templates onto the caller's step id.
 */
export class CompositeBuildStep extends BuildStep {
  public readonly children: BuildStep[];

  constructor(
    ctx: BuildStepGlobalContext,
    {
      id,
      displayName,
      scope,
      children,
      outputTemplates,
    }: {
      id: string;
      displayName: string;
      scope: BuildStepCompositeFunctionScope;
      children: BuildStep[];
      outputTemplates: Array<{ name: string; template: string }>;
    }
  ) {
    const outputs = outputTemplates.map(
      ({ name }) =>
        new BuildStepOutput(ctx, {
          id: name,
          stepDisplayName: displayName,
          required: true,
        })
    );
    // Closes over locals only, never `this`: created before super() runs.
    const fn: BuildStepFunction = (stepCtx, { outputs: outputById, env: stepEnv }) => {
      const base: JobInterpolationContext = {
        ...stepCtx.global.getInterpolationContext(),
        env: stepEnv,
      };
      const scopedContext = scope.getScopedInterpolationContext(base);
      for (const { name, template } of outputTemplates) {
        outputById[name].set(
          stringifyInterpolatedResult(resolveInterpolatedTarget(template, scopedContext))
        );
      }
    };
    super(ctx, {
      id,
      displayName,
      outputs,
      fn,
      ifCondition: '${{ always() }}',
      compositeFunctionScope: scope,
    });
    this.children = children;
  }

  // Safe during super(): outputById is assigned before registerSelf() runs.
  public get hasDeclaredOutputs(): boolean {
    return this.outputs.length > 0;
  }

  /**
   * Nested calls stay hidden; a top-level call is public only when it declares outputs.
   * Consulted by registerSelf() in the base constructor; may only read state assigned
   * before that call (outputById, compositeFunctionScope), never fields like `children`.
   */
  public override get isCompositeFunctionInternal(): boolean {
    return this.compositeFunctionScope?.parent !== undefined || !this.hasDeclaredOutputs;
  }

  // Skip the registry when there are no outputs so we do not shadow a public step that reuses this id.
  protected override registerSelf(ctx: BuildStepGlobalContext): void {
    if (this.hasDeclaredOutputs) {
      super.registerSelf(ctx);
    }
  }

  public getFlattenedSteps(): BuildStep[] {
    const flattened = this.children.flatMap(child =>
      child instanceof CompositeBuildStep ? child.getFlattenedSteps() : [child]
    );
    return this.hasDeclaredOutputs ? [...flattened, this] : flattened;
  }

  // Suppress the step-section log markers so log viewers do not render this bookkeeping node as a phantom step.
  protected override logStepStart(): void {}

  protected override logStepSuccess(): void {}

  protected override logStepSkipped(): void {}

  // Open a step section on failure so error lines do not bleed into the previous step.
  protected override logStepFailed(error: Error): void {
    super.logStepStart();
    super.logStepFailed(error);
  }
}
