import {
  Platform,
  BuildPhase,
  LogMarker,
  errors,
  BuildPhaseResult,
  BuildMode,
  Android,
  Ios,
  BuildJob,
  Generic,
} from '@expo/eas-build-job';
import { Artifacts, BuildContext, Builders, runGenericJobAsync } from '@expo/build-tools';
import { bunyan } from '@expo/logger';
import omit from 'lodash/omit';

import { cleanUpWorkingdir } from './workingdir';
import config from './config';
import { Analytics, Event, logProjectDependenciesAsync } from './external/analytics';
import { displayWorkerRuntimeInfo } from './displayRuntimeInfo';
import { prepareRuntimeEnvironment } from './runtimeEnvironment';

export async function build({
  ctx,
  buildId,
  analytics,
}: {
  ctx: BuildContext;
  buildId: string;
  analytics: Analytics;
}): Promise<Artifacts> {
  const { job, logger } = ctx;
  try {
    analytics.logEvent(Event.WORKER_BUILD_START, {});

    await ctx.runBuildPhase(
      BuildPhase.SPIN_UP_BUILDER,
      async () => {
        displayWorkerRuntimeInfo(ctx);
        ctx.logger.info(
          { job: omit(ctx.job, 'secrets', 'projectArchive') },
          'Builder is ready, starting build'
        );
      },
      { doNotMarkStart: true }
    );
    await ctx.runBuildPhase(BuildPhase.INSTALL_CUSTOM_TOOLS, async () => {
      if (ctx.job.builderEnvironment) {
        await prepareRuntimeEnvironment(ctx, ctx.job.builderEnvironment);
      }
    });

    let artifacts: Artifacts;

    switch (job.platform) {
      case Platform.ANDROID: {
        artifacts = await Builders.androidBuilder(ctx as BuildContext<Android.Job>);
        break;
      }
      case Platform.IOS: {
        artifacts = await Builders.iosBuilder(ctx as BuildContext<Ios.Job>);
        break;
      }
      case undefined: {
        artifacts = {};
        const buildCtx = ctx as BuildContext<Generic.Job>;
        const { runResult } = await runGenericJobAsync(buildCtx, {
          expoApiV2BaseUrl: config.wwwApiV2BaseUrl,
        });

        if (!runResult.ok) {
          throw runResult.reason;
        }
        break;
      }
    }

    if (ctx.job.platform) {
      try {
        await logProjectDependenciesAsync(ctx as BuildContext<BuildJob>, analytics, buildId);
      } catch {
        // do nothing
      }
    }

    analytics.logEvent(Event.WORKER_BUILD_SUCCESS, {});

    return artifacts;
  } catch (err: any) {
    if ('mode' in job && ![BuildMode.CUSTOM, BuildMode.REPACK].includes(job.mode)) {
      logBuildError(logger, analytics, err);
    }
    throw err;
  } finally {
    if (config.env === 'development') {
      await cleanUpWorkingdir();
    }
    await analytics.flushEventsAsync();
  }
}

function logBuildError(logger: bunyan, analytics: Analytics, err: Error): void {
  const l = logger.child({ phase: BuildPhase.FAIL_BUILD });
  l.info({ marker: LogMarker.START_PHASE }, `Start phase: ${BuildPhase.FAIL_BUILD}`);

  if (err instanceof errors.BuildError) {
    analytics.logEvent(Event.WORKER_BUILD_FAIL, {
      reason: err?.message,
      error_code: err.errorCode,
      build_phase: err.buildPhase,
    });
    if (err.errorCode !== errors.ErrorCode.UNKNOWN_ERROR) {
      l.error(`Build failed: ${err.userFacingMessage}`);
    } else {
      l.error({ err: err.innerError ?? err.userFacingMessage }, `Build failed\n`);
    }
  } else {
    // This can only happen when error is thrown outside of a build phase.
    analytics.logEvent(Event.WORKER_BUILD_FAIL, {
      reason: err?.message,
      error_code: errors.ErrorCode.UNKNOWN_ERROR,
    });
    l.error({ err }, `Build failed\n`);
  }

  l.info(
    { marker: LogMarker.END_PHASE, result: BuildPhaseResult.FAIL },
    `End phase: ${BuildPhase.FAIL_BUILD}`
  );
}
