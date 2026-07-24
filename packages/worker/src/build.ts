import {
  Artifacts,
  BuildContext,
  Builders,
  TurtleSshSession,
  runGenericJobAsync,
} from '@expo/build-tools';
import {
  Android,
  BuildJob,
  BuildMode,
  BuildPhase,
  BuildPhaseResult,
  Generic,
  Ios,
  LogMarker,
  Platform,
  errors,
} from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import omit from 'lodash/omit';
import config from './config';
import { displayWorkerRuntimeInfo } from './displayRuntimeInfo';
import { Analytics, Event, logProjectDependenciesAsync } from './external/analytics';
import { prepareRuntimeEnvironment } from './runtimeEnvironment';
import { cleanUpWorkingdir } from './workingdir';

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
  let sshHoldPromise: Promise<void> | undefined;
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

    if (TurtleSshSession.isWorkflowSshEnabled(ctx.env)) {
      // Keep SSH_SESSION open in the log UI until the post-build hold ends: emit START here,
      // skip the automatic END (doNotMarkEnd), and write END when the hold finishes. That way
      // there is still a running step while the worker stays up for SSH idle.
      await ctx.runBuildPhase(
        BuildPhase.SSH_SESSION,
        async () => {
          const phaseStartedAt = Date.now();
          try {
            ctx.logger.info('Opening an SSH session for this job.');
            const workflowJobId = TurtleSshSession.getWorkflowJobIdOrThrow(ctx.env);
            const { handle, idleTimeoutSeconds } = await TurtleSshSession.startSshSessionAsync(
              ctx,
              {
                workflowJobId,
                relayServerUrl: TurtleSshSession.getSshRelayServerUrl(ctx.env),
              }
            );
            ctx.logger.info(`SSH session ready. Connect with: eas workflow:ssh ${workflowJobId}`);
            ctx.logger.info(
              `Closes after ${TurtleSshSession.formatSshIdleTimeoutForLog(idleTimeoutSeconds)} of inactivity. The worker stays up until then.`
            );

            const sshLogger = logger.child({ phase: BuildPhase.SSH_SESSION });
            sshHoldPromise = (async () => {
              let result = BuildPhaseResult.SUCCESS;
              try {
                await TurtleSshSession.holdSshSessionUntilIdleAsync({
                  getConnectedClientCount: () => handle.getConnectedClientCountAsync(),
                  ensureConnected: () => handle.ensureConnectedAsync(),
                  idleTimeoutSeconds,
                  logger: sshLogger,
                });
              } catch (err) {
                result = BuildPhaseResult.WARNING;
                sshLogger.warn({ err }, 'The SSH session ended unexpectedly.');
              } finally {
                await handle.stopAsync().catch(err => {
                  sshLogger.warn({ err }, 'Failed to tear down the SSH tunnel.');
                });
                await handle.closeSessionAsync().catch(err => {
                  sshLogger.warn(
                    { err },
                    'Failed to close the SSH session. It will be cleaned up when the job finishes.'
                  );
                });
                sshLogger.info(
                  {
                    marker: LogMarker.END_PHASE,
                    result,
                    durationMs: Date.now() - phaseStartedAt,
                  },
                  `End phase: ${BuildPhase.SSH_SESSION}`
                );
              }
            })();
          } catch (err) {
            ctx.logger.warn(
              { err },
              'Failed to open the SSH session. The job will continue without it.'
            );
            ctx.markBuildPhaseHasWarnings();
            // Setup failed: close the phase now so doNotMarkEnd does not leave it open forever.
            ctx.logger.info(
              {
                marker: LogMarker.END_PHASE,
                result: BuildPhaseResult.WARNING,
                durationMs: Date.now() - phaseStartedAt,
              },
              `End phase: ${BuildPhase.SSH_SESSION}`
            );
          }
        },
        { doNotMarkEnd: true }
      );
    }

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
        const { runResult } = await runGenericJobAsync(buildCtx);

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
    await sshHoldPromise;
    if (config.env === 'development') {
      await cleanUpWorkingdir();
    }
    await analytics.flushEventsAsync();
  }
}

function logBuildError(logger: bunyan, analytics: Analytics, err: Error): void {
  const l = logger.child({ phase: BuildPhase.FAIL_BUILD });
  l.info({ marker: LogMarker.START_PHASE }, `Start phase: ${BuildPhase.FAIL_BUILD}`);

  if (err instanceof errors.ExpoError) {
    const internalErrorCode = err.trackingCode ?? err.errorCode;
    analytics.logEvent(Event.WORKER_BUILD_FAIL, {
      reason: err?.message,
      error_code: internalErrorCode,
      build_phase: err.buildPhase,
    });
    if (err.errorCode !== errors.ErrorCode.UNKNOWN_ERROR) {
      l.error(`Build failed: ${err.message}`);
    } else {
      l.error({ err: err.cause ?? err }, `Build failed\n`);
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
