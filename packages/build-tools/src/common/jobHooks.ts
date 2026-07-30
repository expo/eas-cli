import {
  BuildJob,
  ErrorCode,
  HookAnchorId,
  HookKey,
  UserError,
  parseHookKey,
  validateSteps,
} from '@expo/eas-build-job';
import {
  BuildStep,
  BuildStepGlobalContext,
  HookEntry,
  constructHookEntriesAsync,
  validateHookStepsAsync,
} from '@expo/steps';

import { BuildContext } from '../context';
import { CustomBuildContext } from '../customBuildContext';
import { getEasFunctionGroups } from '../steps/easFunctionGroups';
import { getEasFunctions } from '../steps/easFunctions';

export interface ParsedJobHooks {
  globalContext: BuildStepGlobalContext;
  // The hook runner re-syncs this from the live BuildContext and runs the
  // hooks against it.
  customBuildContext: CustomBuildContext;
  // One HookEntry per authored hook step (a `uses:` group's whole expansion
  // stays inside one entry). The engine evaluates each entry's `if:` once and
  // isolates within-entry failures, so the boundary must survive to execution.
  hookEntriesByKey: Partial<Record<HookKey, HookEntry[]>>;
}

/**
 * Parses the native job's `hooks` into engine-ready entries, once, at setup
 * time. Shape-validates every registered key (reachable or not); constructs
 * entries only for the anchors this build actually wraps. Returns null when the
 * job declares no hooks.
 */
export async function parseJobHooksAsync<TJob extends BuildJob>(
  ctx: BuildContext<TJob>,
  wrappedAnchors: readonly HookAnchorId[]
): Promise<ParsedJobHooks | null> {
  const hooks = ctx.job.hooks;
  if (!hooks || Object.keys(hooks).length === 0) {
    return null;
  }

  const customBuildContext = new CustomBuildContext(ctx);
  const globalContext = new BuildStepGlobalContext(customBuildContext, false);
  // Hook steps run in the checked-out project directory, not the pre-checkout
  // target directory the global context defaults to.
  globalContext.markAsCheckedOut(ctx.logger);

  const externalFunctions = getEasFunctions(customBuildContext);
  const externalFunctionGroups = getEasFunctionGroups(customBuildContext);

  // Shape-validate every REGISTERED key, reachable or not (steps-world parity:
  // a malformed `before_submit` fails a steps build, so it fails here too), and
  // warn on keys this build won't run. An unknown key is inert — a key newer
  // than this worker must be ignored, never fail the job.
  for (const [key, steps] of Object.entries(hooks)) {
    const parsed = parseHookKey(key);
    if (parsed === null) {
      ctx.logger.warn(`Ignoring unknown hook key "${key}".`);
      continue;
    }
    if (Array.isArray(steps) && steps.length === 0) {
      // `[]` is an explicit opt-out; validateSteps requires >= 1 step.
      continue;
    }
    try {
      validateSteps(steps);
    } catch (err) {
      throw new UserError(
        ErrorCode.HOOKS_ERROR,
        `Invalid steps in "hooks.${key}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
    // Registered but not wrapped by this build: shape-checked above, then
    // skipped. Function existence is deliberately NOT checked (that happens only
    // during construction) — an unknown `uses:` under an unwrapped key warns
    // rather than failing the build.
    if (!wrappedAnchors.includes(parsed.anchorId)) {
      ctx.logger.warn(
        `Ignoring "hooks.${key}": this build does not run the "${parsed.anchorId}" step.`
      );
    }
  }

  // Construct entries for the wrapped anchors in EXECUTION order (per anchor,
  // before_ then after_) so generated step ids and output references follow the
  // order steps actually run. All entries share one globalContext, so env and
  // outputs accumulate across keys.
  const hookEntriesByKey: Partial<Record<HookKey, HookEntry[]>> = {};
  const orderedSteps: BuildStep[] = [];
  for (const anchor of wrappedAnchors) {
    for (const side of ['before', 'after'] as const) {
      const key: HookKey = `${side}_${anchor}`;
      const steps = hooks[key];
      if (!Array.isArray(steps) || steps.length === 0) {
        continue;
      }
      let entries: HookEntry[];
      try {
        entries = await constructHookEntriesAsync(globalContext, steps, {
          externalFunctions,
          externalFunctionGroups,
        });
      } catch (err) {
        throw new UserError(
          ErrorCode.HOOKS_ERROR,
          `Failed to parse hooks.${key}: ${err instanceof Error ? err.message : String(err)}. Hooks use the same syntax as workflow steps.`,
          { cause: err }
        );
      }
      hookEntriesByKey[key] = entries;
      for (const entry of entries) {
        orderedSteps.push(...entry.steps);
      }
    }
  }

  // One aggregate pass over every constructed step in execution order: unique
  // ids, output references, and platform allowance. Per-key validation misses
  // cross-key id collisions and would reject a legal after -> before output
  // reference as a future reference.
  try {
    await validateHookStepsAsync(globalContext, orderedSteps);
  } catch (err) {
    throw new UserError(
      ErrorCode.HOOKS_ERROR,
      `The job's hooks are invalid: ${err instanceof Error ? err.message : String(err)}. Fix the reported step ids or output references.`,
      { cause: err }
    );
  }

  return { globalContext, customBuildContext, hookEntriesByKey };
}
