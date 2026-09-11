import { BuildContext, TurtleSshSession, formatSecondsForLog } from '@expo/build-tools';
import { BuildPhase, BuildPhaseResult, LogMarker } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { performance } from 'node:perf_hooks';

export async function startSshSessionPhaseAsync({
  ctx,
  buildId,
  logger,
  hasJobFinished,
}: {
  ctx: BuildContext;
  buildId: string;
  logger: bunyan;
  hasJobFinished: () => boolean;
}): Promise<{ done?: Promise<void> }> {
  let done: Promise<void> | undefined;

  await ctx.runBuildPhase(
    BuildPhase.SSH_SESSION,
    async () => {
      const phaseStartedAt = performance.now();
      try {
        ctx.logger.info('Opening an SSH session for this job.');
        const target = {
          type: ctx.job.platform ? ('BUILD' as const) : ('JOB_RUN' as const),
          id: buildId,
        };
        const { handle, idleTimeoutSeconds } = await TurtleSshSession.startSshSessionAsync(ctx, {
          target,
          relayServerUrl: TurtleSshSession.getSshRelayServerUrl(ctx.job),
          idleTimeoutSeconds: TurtleSshSession.getSshIdleTimeoutSeconds(ctx.job),
        });
        ctx.logger.info(`SSH session ready. Connect with: eas workflow:ssh ${buildId}`);
        ctx.logger.info(
          idleTimeoutSeconds === 0
            ? 'It stays open for the whole job and closes once the job finishes and no client is connected.'
            : `It stays open for the whole job, then closes after ${formatSecondsForLog(idleTimeoutSeconds)} with no client connected. The worker stays up until then.`
        );

        const sshLogger = logger.child({ phase: BuildPhase.SSH_SESSION });
        done = (async () => {
          let result = BuildPhaseResult.SUCCESS;
          try {
            await TurtleSshSession.superviseSshSessionAsync({
              handle,
              idleTimeoutSeconds,
              hasJobFinished,
              logger: sshLogger,
            });
          } catch (err) {
            result = BuildPhaseResult.WARNING;
            sshLogger.warn({ err }, 'The SSH session ended unexpectedly.');
          } finally {
            await handle.stopAsync().catch(err => {
              sshLogger.warn({ err }, 'Failed to tear down the SSH tunnel.');
            });
            sshLogger.info(
              {
                marker: LogMarker.END_PHASE,
                result,
                durationMs: Math.round(performance.now() - phaseStartedAt),
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
        ctx.logger.info(
          {
            marker: LogMarker.END_PHASE,
            result: BuildPhaseResult.WARNING,
            durationMs: Math.round(performance.now() - phaseStartedAt),
          },
          `End phase: ${BuildPhase.SSH_SESSION}`
        );
      }
    },
    { doNotMarkEnd: true }
  );

  return { done };
}
