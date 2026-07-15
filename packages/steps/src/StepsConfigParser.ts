import {
  ActionCatalog,
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
import { ActionExpander, FunctionMaps } from './ActionExpander';
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
import { isActionPath, parseActionPath } from './utils/localActions';

export class StepsConfigParser extends AbstractConfigParser {
  private readonly steps: Step[];
  private readonly hooks: Hooks;
  /** Pre-loaded action configs keyed by normalized path (e.g. `./.eas/actions/setup`). */
  private readonly actionCatalog: ActionCatalog;
  // Anchors present in the job's own steps, collected during construction.
  // Used to warn about payload hook keys whose anchor never occurred.
  private readonly encounteredHookAnchors = new Set<HookAnchorId>();

  constructor(
    ctx: BuildStepGlobalContext,
    {
      steps,
      hooks,
      externalFunctions,
      externalFunctionGroups,
      actionCatalog,
    }: {
      steps: Step[];
      // Required (not `hooks?:`) so a call site cannot silently forget to pass
      // the job's hooks — forgetting drops them without a trace.
      hooks: Hooks | undefined;
      externalFunctions?: BuildFunction[];
      externalFunctionGroups?: BuildFunctionGroup[];
      actionCatalog?: ActionCatalog;
    }
  ) {
    super(ctx, {
      externalFunctions,
      externalFunctionGroups,
    });

    this.steps = steps;
    this.hooks = hooks ?? {};
    this.actionCatalog = actionCatalog ?? {};
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

    // Only the job's own steps are scanned — steps constructed from hooks are
    // never treated as anchors (no nesting). Construction order (before →
    // anchor → after per occurrence; groups expand first) keeps generated
    // step ids identical across the splicing→engine rollout.
    const buildSteps: BuildStep[] = [];
    const hooksByAnchorStep = new Map<BuildStep, AnchorHooks>();

    for (const stepConfig of validatedSteps) {
      const maybeFunctionGroup =
        isStepFunctionStep(stepConfig) && !isActionPath(stepConfig.uses)
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
          this.encounteredHookAnchors.add(anchorId);
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
        buildSteps.push(...this.createBuildStepsFromNonGroupStepConfig(stepConfig, maps));
        continue;
      }
      this.encounteredHookAnchors.add(anchorId);
      const before = this.constructHookSideEntries(anchorId, 'before', validatedHooks, maps);
      const createdSteps = this.createBuildStepsFromNonGroupStepConfig(stepConfig, maps);
      if (createdSteps.length !== 1) {
        throw new BuildConfigError(
          'Hook anchors are not supported on local action steps that expand into multiple build steps.'
        );
      }
      const anchorStep = createdSteps[0];
      buildSteps.push(anchorStep);
      const after = this.constructHookSideEntries(anchorId, 'after', validatedHooks, maps);
      if (before.length > 0 || after.length > 0) {
        hooksByAnchorStep.set(anchorStep, { anchor: anchorId, before, after });
      }
    }

    // After construction: group expansions also record encountered anchors.
    this.warnAboutUnmatchedHookKeys();

    return {
      buildSteps,
      buildFunctionById,
      hooksByAnchorStep,
    };
  }

  private validateHooks(): Record<string, Step[]> {
    const validatedHooks: Record<string, Step[]> = {};
    for (const [hookKey, hookSteps] of Object.entries(this.hooks)) {
      // Keys that don't name a registered anchor are fully inert — never
      // validated, never constructed, reported by warnAboutUnmatchedHookKeys.
      // A worker must not fail on hook keys newer than itself, even when their
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

  private createBuildStepsFromNonGroupStepConfig(
    stepConfig: Step,
    { buildFunctionById, buildFunctionGroupById }: FunctionMaps
  ): BuildStep[] {
    if (isStepShellStep(stepConfig)) {
      return [createBuildStepFromShellStep(this.ctx, stepConfig)];
    }
    if (isStepFunctionStep(stepConfig)) {
      return this.createBuildStepsFromFunctionStepConfig(stepConfig, {
        buildFunctionById,
        buildFunctionGroupById,
      });
    }
    throw new BuildConfigError(
      'Invalid job step configuration detected. Step must be shell or function step'
    );
  }

  private createBuildStepsFromFunctionStepConfig(
    step: FunctionStep,
    { buildFunctionById, buildFunctionGroupById }: FunctionMaps
  ): BuildStep[] {
    if (isActionPath(step.uses)) {
      const expander = new ActionExpander(this.ctx, this.actionCatalog, {
        buildFunctionById,
        buildFunctionGroupById,
      });
      return expander.expandActionStep(
        step,
        parseActionPath(step.uses),
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
