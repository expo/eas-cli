import {
  CompositeFunctionCatalog,
  FunctionStep,
  HookAnchorId,
  Hooks,
  Step,
  isHookAnchorId,
  isStepFunctionStep,
  isStepShellStep,
  parseHookKey,
  validateSteps,
} from '@expo/eas-build-job';
import assert from 'node:assert';

import { AbstractConfigParser } from './AbstractConfigParser';
import { CompositeFunctionExpander, FunctionMaps } from './CompositeFunctionExpander';
import { BuildFunction, BuildFunctionById, createBuildFunctionByIdMapping } from './BuildFunction';
import {
  BuildFunctionGroup,
  BuildFunctionGroupById,
  createBuildFunctionGroupByIdMapping,
} from './BuildFunctionGroup';
import { BuildStep } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildConfigError } from './errors';
import {
  AnchorHooks,
  HookEntry,
  constructHookEntriesFromValidatedSteps,
  createBuildStepFromShellStep,
  validateAllStepFunctionsExist,
} from './hooks';
import {
  isLocalCompositeFunctionPath,
  parseLocalCompositeFunctionPath,
} from './utils/localCompositeFunctions';

export class StepsConfigParser extends AbstractConfigParser {
  private readonly steps: Step[];
  private readonly hooks: Hooks;
  /** Pre-loaded composite function configs keyed by normalized path (e.g. `./.eas/functions/setup`). */
  private readonly compositeFunctionCatalog: CompositeFunctionCatalog;

  constructor(
    ctx: BuildStepGlobalContext,
    {
      steps,
      hooks,
      externalFunctions,
      externalFunctionGroups,
      compositeFunctionCatalog,
    }: {
      steps: Step[];
      // Required (not `hooks?:`) so a call site cannot silently forget to pass
      // the job's hooks — forgetting drops them without a trace.
      hooks: Hooks | undefined;
      externalFunctions?: BuildFunction[];
      externalFunctionGroups?: BuildFunctionGroup[];
      compositeFunctionCatalog?: CompositeFunctionCatalog;
    }
  ) {
    super(ctx, {
      externalFunctions,
      externalFunctionGroups,
    });

    this.steps = steps;
    this.hooks = hooks ?? {};
    this.compositeFunctionCatalog = compositeFunctionCatalog ?? {};
  }

  protected async parseConfigToBuildStepsAndBuildFunctionByIdMappingAsync(): Promise<{
    buildSteps: BuildStep[];
    buildFunctionById: BuildFunctionById;
    hooksByAnchorStep: ReadonlyMap<BuildStep, AnchorHooks>;
  }> {
    const validatedSteps = validateSteps(this.steps);
    const validatedHooks = this.validateHooks();
    // Hook steps are validated like job steps: a hook `uses:` naming an
    // unknown function must be a BuildConfigError, not an assertion crash.
    validateAllStepFunctionsExist([...validatedSteps, ...Object.values(validatedHooks).flat()], {
      externalFunctionIds: this.getExternalFunctionFullIds(),
      externalFunctionGroupIds: this.getExternalFunctionGroupFullIds(),
    });

    const buildFunctionById = createBuildFunctionByIdMapping(this.externalFunctions ?? []);
    const buildFunctionGroupById = createBuildFunctionGroupByIdMapping(
      this.externalFunctionGroups ?? []
    );
    const compositeFunctionExpander = new CompositeFunctionExpander(
      this.ctx,
      this.compositeFunctionCatalog,
      {
        buildFunctionById,
        buildFunctionGroupById,
      }
    );

    // Only the job's own steps are scanned — steps constructed from hooks are
    // never treated as anchors (no nesting). Construction order (before →
    // anchor → after per occurrence; groups expand first) keeps generated
    // step ids identical across the splicing→engine rollout.
    const buildSteps: BuildStep[] = [];
    const hooksByAnchorStep = new Map<BuildStep, AnchorHooks>();

    for (const stepConfig of validatedSteps) {
      const maybeFunctionGroup =
        isStepFunctionStep(stepConfig) && !isLocalCompositeFunctionPath(stepConfig.uses)
          ? buildFunctionGroupById[stepConfig.uses]
          : undefined;
      if (maybeFunctionGroup !== undefined) {
        // The group expands FIRST (its internal steps get their ids), then the
        // anchors found among expanded steps get their hook steps constructed.
        // TODO: allow to set id, name, working_directory, shell, env and if
        // for function groups
        const expandedSteps = maybeFunctionGroup.createBuildStepsFromFunctionGroupCall(this.ctx, {
          callInputs: stepConfig.with,
        });
        buildSteps.push(...expandedSteps);
        for (const expandedStep of expandedSteps) {
          const anchorId = expandedStep.__hookId;
          if (anchorId === undefined) {
            continue;
          }
          const anchorHooks = this.constructAnchorHooks(anchorId, validatedHooks, {
            buildFunctionById,
            buildFunctionGroupById,
          });
          if (anchorHooks !== undefined) {
            hooksByAnchorStep.set(expandedStep, anchorHooks);
          }
        }
        continue;
      }

      const maps = { buildFunctionById, buildFunctionGroupById };
      const anchorId = StepsConfigParser.resolveStepAnchor(stepConfig, buildFunctionById);
      if (anchorId === undefined) {
        buildSteps.push(
          ...this.createBuildStepsFromNonGroupStepConfig(
            stepConfig,
            maps,
            compositeFunctionExpander
          )
        );
        continue;
      }
      // Rejected regardless of expansion size: the anchor would land on an
      // expanded inner step, and hooks never fire inside a composite function.
      if (isStepFunctionStep(stepConfig) && isLocalCompositeFunctionPath(stepConfig.uses)) {
        throw new BuildConfigError(
          'Hook anchors are not supported on local composite function steps.'
        );
      }
      const before = this.constructHookSideEntries(anchorId, 'before', validatedHooks, maps);
      const createdSteps = this.createBuildStepsFromNonGroupStepConfig(
        stepConfig,
        maps,
        compositeFunctionExpander
      );
      assert(
        createdSteps.length === 1,
        'a non-composite step config must create exactly one build step'
      );
      const anchorStep = createdSteps[0];
      buildSteps.push(anchorStep);
      const after = this.constructHookSideEntries(anchorId, 'after', validatedHooks, maps);
      if (before.length > 0 || after.length > 0) {
        hooksByAnchorStep.set(anchorStep, { anchor: anchorId, before, after });
      }
    }

    return {
      buildSteps,
      buildFunctionById,
      hooksByAnchorStep,
    };
  }

  private validateHooks(): Record<string, Step[]> {
    const validatedHooks: Record<string, Step[]> = {};
    for (const [hookKey, hookSteps] of Object.entries(this.hooks)) {
      // A worker must not fail on a hook key newer than itself, so unregistered
      // keys skip validation entirely (their steps may reference functions this
      // worker lacks).
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

  /**
   * Resolves a non-group step's anchor. Stamp PRESENCE wins, not stamp
   * registration: an unregistered stamp value makes the step inert — it never
   * falls through to the invoked function's declaration (a newer server
   * stamping a function step with a future anchor must not silently rebind it
   * to the function's older anchor on this worker). Only when the field is
   * absent does a function step resolve via its function's own declaration.
   */
  private static resolveStepAnchor(
    step: Step,
    buildFunctionById: BuildFunctionById
  ): HookAnchorId | undefined {
    if (step.__hook_id !== undefined) {
      return isHookAnchorId(step.__hook_id) ? step.__hook_id : undefined;
    }
    if (isStepFunctionStep(step)) {
      return buildFunctionById[step.uses]?.__hookId;
    }
    return undefined;
  }

  private constructAnchorHooks(
    anchorId: HookAnchorId,
    validatedHooks: Record<string, Step[]>,
    maps: {
      buildFunctionById: BuildFunctionById;
      buildFunctionGroupById: BuildFunctionGroupById;
    }
  ): AnchorHooks | undefined {
    const before = this.constructHookSideEntries(anchorId, 'before', validatedHooks, maps);
    const after = this.constructHookSideEntries(anchorId, 'after', validatedHooks, maps);
    if (before.length === 0 && after.length === 0) {
      return undefined;
    }
    return { anchor: anchorId, before, after };
  }

  private constructHookSideEntries(
    anchorId: HookAnchorId,
    side: 'before' | 'after',
    validatedHooks: Record<string, Step[]>,
    maps: {
      buildFunctionById: BuildFunctionById;
      buildFunctionGroupById: BuildFunctionGroupById;
    }
  ): HookEntry[] {
    const hookSteps = validatedHooks[`${side}_${anchorId}`];
    if (hookSteps === undefined) {
      return [];
    }
    return constructHookEntriesFromValidatedSteps(this.ctx, hookSteps, maps);
  }

  private createBuildStepsFromNonGroupStepConfig(
    stepConfig: Step,
    maps: FunctionMaps,
    compositeFunctionExpander: CompositeFunctionExpander
  ): BuildStep[] {
    if (isStepShellStep(stepConfig)) {
      return [createBuildStepFromShellStep(this.ctx, stepConfig)];
    }
    if (isStepFunctionStep(stepConfig)) {
      return this.createBuildStepsFromFunctionStepConfig(
        stepConfig,
        maps,
        compositeFunctionExpander
      );
    }
    throw new BuildConfigError(
      'Invalid job step configuration detected. Step must be shell or function step'
    );
  }

  private createBuildStepsFromFunctionStepConfig(
    step: FunctionStep,
    { buildFunctionById }: FunctionMaps,
    compositeFunctionExpander: CompositeFunctionExpander
  ): BuildStep[] {
    if (isLocalCompositeFunctionPath(step.uses)) {
      return compositeFunctionExpander.expandCompositeFunctionStep(
        step,
        parseCompositeFunctionPath(step.uses),
        BuildStep.getNewId(step.id)
      );
    }

    const buildFunction = buildFunctionById[step.uses];
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
      }),
    ];
  }
}
