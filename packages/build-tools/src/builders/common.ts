import { BuildJob, BuildPhase, Ios, Platform } from '@expo/eas-build-job';

import { Artifacts, BuildContext } from '../context';
import { findAndUploadXcodeBuildLogsAsync } from '../ios/xcodeBuildLogs';
import { maybeFindAndUploadBuildArtifacts } from '../utils/artifacts';
import { Hook, runHookIfPresent } from '../utils/hooks';

export async function runBuilderWithHooksAsync<T extends BuildJob>(
  ctx: BuildContext<T>,
  builderAsync: (ctx: BuildContext<T>) => Promise<void>
): Promise<Artifacts> {
  try {
    let buildSuccess = true;
    try {
      await builderAsync(ctx);
      await ctx.runBuildPhase(BuildPhase.ON_BUILD_SUCCESS_HOOK, async () => {
        await runHookIfPresent(ctx, Hook.ON_BUILD_SUCCESS);
      });
    } catch (err: any) {
      buildSuccess = false;
      await ctx.runBuildPhase(BuildPhase.ON_BUILD_ERROR_HOOK, async () => {
        await runHookIfPresent(ctx, Hook.ON_BUILD_ERROR);
      });
      throw err;
    } finally {
      await ctx.runBuildPhase(BuildPhase.ON_BUILD_COMPLETE_HOOK, async () => {
        await runHookIfPresent(ctx, Hook.ON_BUILD_COMPLETE, {
          extraEnvs: {
            EAS_BUILD_STATUS: buildSuccess ? 'finished' : 'errored',
          },
        });
      });

      if (ctx.job.platform === Platform.IOS) {
        await findAndUploadXcodeBuildLogsAsync(ctx as BuildContext<Ios.Job>, {
          logger: ctx.logger,
        });
      }

      await ctx.runBuildPhase(BuildPhase.UPLOAD_BUILD_ARTIFACTS, async () => {
        await maybeFindAndUploadBuildArtifacts(ctx, {
          logger: ctx.logger,
        });
      });
    }
  } catch (err: any) {
    err.artifacts = ctx.artifacts;
    throw err;
  }

  return ctx.artifacts;
}
