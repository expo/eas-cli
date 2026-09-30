import {
  BuildJob,
  BuildPhase,
  ErrorCode,
  HookAnchorId,
  HookKey,
  UserError,
} from '@expo/eas-build-job';
import { executeHookStepsAsync } from '@expo/steps';

import { BuildContext } from '../context';
import { ParsedJobHooks } from './jobHooks';

/**
 * Runs a native build phase with its `before_<anchor>` / `after_<anchor>` hooks
 * wrapped around it: before-entries -> phase (in a try) -> after-entries, with
 * after-on-failure guaranteed. A failing before sequence skips the phase AND the
 * after-hooks (steps-engine parity). The phase error always wins over an
 * after-hook error. Passthrough (no hooks or no keys for this anchor) runs the
 * phase exactly once with zero overhead.
 */
export async function runHookableBuildPhaseAsync<TJob extends BuildJob, T>({
  ctx,
  hooks,
  buildPhase,
  anchor,
  fn,
}: {
  ctx: BuildContext<TJob>;
  hooks: ParsedJobHooks | null;
  buildPhase: BuildPhase;
  anchor: HookAnchorId;
  fn: () => Promise<T>;
}): Promise<T> {
  // runHookEntriesAsync no-ops when the key has no entries.
  if (hooks) {
    await runHookEntriesAsync({ ctx, hooks, timing: 'before', anchor });
  }

  let result: T;
  try {
    result = await ctx.runBuildPhase(buildPhase, fn);
  } catch (phaseError) {
    if (hooks) {
      try {
        await runHookEntriesAsync({ ctx, hooks, timing: 'after', anchor, anchorFailed: true });
      } catch (hookError) {
        // The phase error wins; still surface the after-hook failure in the log.
        ctx.logger.error({ err: hookError }, `after_${anchor} hook failed`);
      }
    }
    throw phaseError;
  }

  if (hooks) {
    await runHookEntriesAsync({ ctx, hooks, timing: 'after', anchor, anchorFailed: false });
  }
  return result;
}

async function runHookEntriesAsync<TJob extends BuildJob>({
  ctx,
  hooks,
  timing,
  anchor,
  anchorFailed = false,
}: {
  ctx: BuildContext<TJob>;
  hooks: ParsedJobHooks;
  timing: 'before' | 'after';
  anchor: HookAnchorId;
  anchorFailed?: boolean;
}): Promise<void> {
  const hookKey: HookKey = `${timing}_${anchor}`;
  const entries = hooks.hookEntriesByKey[hookKey];
  if (!entries?.length) {
    return;
  }

  // Refresh the hook context from the live BuildContext before running: env
  // moves as the build runs (set-env written back below; profile env), and
  // job/metadata are replaced by eas build:internal.
  hooks.customBuildContext.updateEnv(ctx.env);
  // Overwrite the job/metadata snapshot; NOT updateJobInformation, whose
  // delta-merge would duplicate environmentSecrets on each refresh.
  hooks.customBuildContext.job = ctx.job;
  hooks.customBuildContext.metadata = ctx.metadata;

  if (timing === 'after' && anchorFailed) {
    // Mirror the engine: the anchor's failure is marked on the shared context so
    // `failure()` / `success()` on after-hook steps read the phase outcome.
    hooks.globalContext.markAsFailed();
  }

  const { failedLocally, firstError } = await executeHookStepsAsync(hooks.globalContext, entries, {
    anchor,
    timing,
    ...(timing === 'after' ? { anchorResult: anchorFailed ? 'failed' : 'success' } : null),
  });

  // Reverse write-back BEFORE propagating a failure: env set by the entries that
  // did run must reach the build context even when a later entry failed, so the
  // native phases (and the outer lifecycle hooks) see it. Hook-carrying builds
  // are git-based, so updateEnv's gate does not fire here.
  ctx.updateEnv(hooks.globalContext.env);

  if (failedLocally) {
    throw new UserError(
      ErrorCode.HOOKS_ERROR,
      `Hook "${hookKey}" failed: ${
        firstError instanceof Error ? firstError.message : String(firstError)
      }. Check the failing hook step's logs above.`,
      { cause: firstError }
    );
  }
}
