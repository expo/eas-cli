import {
  FunctionStep,
  HookAnchorId,
  HookKey,
  Hooks,
  LocalFunctionCatalog,
  LocalFunctionConfig,
  Step,
  isHookAnchorId,
  isStepFunctionStep,
  isStepShellStep,
  parseHookKey,
  validateSteps,
} from '@expo/eas-build-job';
import assert from 'node:assert';

import { AbstractConfigParser } from './AbstractConfigParser';
import { LocalFunctionExpander } from './LocalFunctionExpander';
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
  extendLocalFunctionCatalogFromStepsAsync,
  isLocalFunctionPath,
  parseLocalFunctionPath,
} from './utils/localFunctions';

type ValidatedHooks = ReadonlyMap<HookKey, { anchorId: HookAnchorId; steps: Step[] }>;

export class StepsConfigParser extends AbstractConfigParser {
  private readonly steps: Step[];
  private readonly hooks: Hooks;
  /** Pre-loaded local function configs keyed by normalized path (e.g. `./.eas/functions/setup`). */
  private readonly localFunctionCatalog: LocalFunctionCatalog;
  private readonly loadLocalFunction?: (functionPath: string) => Promise<LocalFunctionConfig>;

  constructor(
    ctx: BuildStepGlobalContext,
    {
      steps,
      hooks,
      externalFunctions,
      externalFunctionGroups,
      localFunctionCatalog,
      loadLocalFunction,
    }: {
      steps: Step[];
      // Required (not `hooks?:`) so a call site cannot silently forget to pass
      // the job's hooks — forgetting drops them without a trace.
      hooks: Hooks | undefined;
      externalFunctions?: BuildFunction[];
      externalFunctionGroups?: BuildFunctionGroup[];
      localFunctionCatalog?: LocalFunctionCatalog;
      /** Loads a hook local function missing from the catalog. When omitted, missing entries fail as unknown. */
      loadLocalFunction?: (functionPath: string) => Promise<LocalFunctionConfig>;
    }
  ) {
    super(ctx, {
      externalFunctions,
      externalFunctionGroups,
    });

    this.steps = steps;
    this.hooks = hooks ?? {};
    // Shallow copy so lazy loading never mutates a caller-owned catalog.
    this.localFunctionCatalog = { ...(localFunctionCatalog ?? {}) };
    this.loadLocalFunction = loadLocalFunction;
  }

  protected async parseConfigToBuildStepsAndBuildFunctionByIdMappingAsync(): Promise<{
    buildSteps: BuildStep[];
    buildFunctionById: BuildFunctionById;
    hooksByAnchorStep: ReadonlyMap<BuildStep, AnchorHooks>;
  }> {
    const validatedSteps = validateSteps(this.steps);
    const validatedHooks = this.validateHooks();
    validateAllStepFunctionsExist(validatedSteps, {
      externalFunctionIds: this.getExternalFunctionFullIds(),
      externalFunctionGroupIds: this.getExternalFunctionGroupFullIds(),
    });

    const buildFunctionById = createBuildFunctionByIdMapping(this.externalFunctions ?? []);
    const buildFunctionGroupById = createBuildFunctionGroupByIdMapping(
      this.externalFunctionGroups ?? []
    );
    // Expander shares this catalog by reference; it grows as hook composites load.
    const localFunctionExpander = new LocalFunctionExpander(this.ctx, this.localFunctionCatalog, {
      buildFunctionById,
      buildFunctionGroupById,
    });

    // Only the job's own steps are scanned — steps constructed from hooks are
    // never treated as anchors (no nesting). Construction order (before →
    // anchor → after per occurrence; groups expand first) keeps generated
    // step ids identical across the splicing→engine rollout.
    const buildSteps: BuildStep[] = [];
    const hooksByAnchorStep = new Map<BuildStep, AnchorHooks>();
    const seenAnchorIds = new Set<HookAnchorId>();

    for (const stepConfig of validatedSteps) {
      const maybeFunctionGroup =
        isStepFunctionStep(stepConfig) && !isLocalFunctionPath(stepConfig.uses)
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
          seenAnchorIds.add(anchorId);
          const anchorHooks = await this.constructAnchorHooksAsync(
            anchorId,
            validatedHooks,
            localFunctionExpander
          );
          if (anchorHooks !== undefined) {
            hooksByAnchorStep.set(expandedStep, anchorHooks);
          }
        }
        continue;
      }

      const anchorId = StepsConfigParser.resolveStepAnchor(stepConfig, buildFunctionById);
      if (anchorId === undefined) {
        buildSteps.push(
          ...this.createBuildStepsFromNonGroupStepConfig(stepConfig, localFunctionExpander)
        );
        continue;
      }
      // For composite functions the anchor would land on an expanded inner step. Single-step
      // functions keep the same restriction so anchor support does not depend on the function's
      // shape.
      if (isStepFunctionStep(stepConfig) && isLocalFunctionPath(stepConfig.uses)) {
        throw new BuildConfigError(
          'Hook anchors are not supported on steps that call a local function.'
        );
      }
      seenAnchorIds.add(anchorId);
      const before = await this.constructHookSideEntriesAsync(
        anchorId,
        'before',
        validatedHooks,
        localFunctionExpander
      );
      const createdSteps = this.createBuildStepsFromNonGroupStepConfig(
        stepConfig,
        localFunctionExpander
      );
      assert(
        createdSteps.length === 1,
        'a non-composite step config must create exactly one build step'
      );
      const anchorStep = createdSteps[0];
      buildSteps.push(anchorStep);
      const after = await this.constructHookSideEntriesAsync(
        anchorId,
        'after',
        validatedHooks,
        localFunctionExpander
      );
      if (before.length > 0 || after.length > 0) {
        hooksByAnchorStep.set(anchorStep, { anchor: anchorId, before, after });
      }
    }

    for (const [hookKey, { anchorId }] of validatedHooks) {
      if (!seenAnchorIds.has(anchorId)) {
        this.ctx.baseLogger.warn(
          `Ignoring "hooks.${hookKey}": this build does not run the "${anchorId}" step.`
        );
      }
    }

    return {
      buildSteps,
      buildFunctionById,
      hooksByAnchorStep,
    };
  }

  private validateHooks(): ValidatedHooks {
    const validatedHooks = new Map<HookKey, { anchorId: HookAnchorId; steps: Step[] }>();
    for (const [hookKey, hookSteps] of Object.entries(this.hooks)) {
      // A worker must not fail on a hook key newer than itself, so unregistered
      // keys skip validation entirely (their steps may reference functions this
      // worker lacks).
      const parsed = parseHookKey(hookKey);
      if (parsed === null) {
        this.ctx.baseLogger.warn(`Ignoring unknown hook key "${hookKey}".`);
        continue;
      }
      // An empty array is a deliberate no-op (e.g. opting out of a default);
      // any other non-step-array shape falls through to validateSteps below so
      // it errors instead of being dropped silently.
      if (Array.isArray(hookSteps) && hookSteps.length === 0) {
        continue;
      }
      try {
        validatedHooks.set(`${parsed.side}_${parsed.anchorId}`, {
          anchorId: parsed.anchorId,
          steps: validateSteps(hookSteps),
        });
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

  private async constructAnchorHooksAsync(
    anchorId: HookAnchorId,
    validatedHooks: ValidatedHooks,
    localFunctionExpander: LocalFunctionExpander
  ): Promise<AnchorHooks | undefined> {
    const before = await this.constructHookSideEntriesAsync(
      anchorId,
      'before',
      validatedHooks,
      localFunctionExpander
    );
    const after = await this.constructHookSideEntriesAsync(
      anchorId,
      'after',
      validatedHooks,
      localFunctionExpander
    );
    if (before.length === 0 && after.length === 0) {
      return undefined;
    }
    return { anchor: anchorId, before, after };
  }

  private async constructHookSideEntriesAsync(
    anchorId: HookAnchorId,
    side: 'before' | 'after',
    validatedHooks: ValidatedHooks,
    localFunctionExpander: LocalFunctionExpander
  ): Promise<HookEntry[]> {
    const hookSteps = validatedHooks.get(`${side}_${anchorId}`)?.steps;
    if (hookSteps === undefined) {
      return [];
    }
    try {
      validateAllStepFunctionsExist(hookSteps, {
        externalFunctionIds: this.getExternalFunctionFullIds(),
        externalFunctionGroupIds: this.getExternalFunctionGroupFullIds(),
      });
    } catch (err) {
      throw new BuildConfigError(
        `Invalid steps in "hooks.${side}_${anchorId}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    if (this.loadLocalFunction !== undefined) {
      // Load only once the anchor runs, so unused anchors do not fail on missing composites.
      try {
        await extendLocalFunctionCatalogFromStepsAsync({
          catalog: this.localFunctionCatalog,
          rootSteps: hookSteps,
          loadLocalFunction: this.loadLocalFunction,
        });
      } catch (err) {
        if (err instanceof BuildConfigError) {
          throw new BuildConfigError(
            `Invalid steps in "hooks.${side}_${anchorId}": ${err.message}`
          );
        }
        throw new BuildConfigError(
          `Failed to load a local function referenced from "hooks.${side}_${anchorId}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    try {
      return constructHookEntriesFromValidatedSteps(this.ctx, hookSteps, localFunctionExpander);
    } catch (err) {
      if (err instanceof BuildConfigError) {
        throw new BuildConfigError(`Invalid steps in "hooks.${side}_${anchorId}": ${err.message}`);
      }
      throw err;
    }
  }

  private createBuildStepsFromNonGroupStepConfig(
    stepConfig: Step,
    localFunctionExpander: LocalFunctionExpander
  ): BuildStep[] {
    if (isStepShellStep(stepConfig)) {
      return [createBuildStepFromShellStep(this.ctx, stepConfig)];
    }
    if (isStepFunctionStep(stepConfig)) {
      return this.createBuildStepsFromFunctionStepConfig(stepConfig, localFunctionExpander);
    }
    throw new BuildConfigError(
      'Invalid job step configuration detected. Step must be shell or function step'
    );
  }

  private createBuildStepsFromFunctionStepConfig(
    step: FunctionStep,
    localFunctionExpander: LocalFunctionExpander
  ): BuildStep[] {
    if (isLocalFunctionPath(step.uses)) {
      return localFunctionExpander.expandLocalFunctionStep(
        step,
        parseLocalFunctionPath(step.uses),
        BuildStep.getNewId(step.id)
      );
    }

    const buildFunction = localFunctionExpander.buildFunctionById[step.uses];
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
