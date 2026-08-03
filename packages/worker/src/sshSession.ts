import { BuildContext, TurtleSshSession } from '@expo/build-tools';
import { BuildPhase, BuildPhaseResult, LogMarker } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';

/**
 * Opens the job's SSH session. `done` settles once the tunnel is torn down, and is absent when
 * the session could not be opened. It is wrapped in an object because an async function flattens
 * a returned promise, which would make callers wait for the whole session.
 *
 * SSH_SESSION stays open in the log UI for as long as the tunnel lives: we emit START here, skip
 * the automatic END (doNotMarkEnd), and write END on teardown. That way there is still a running
 * step while the worker stays up for SSH.
 */
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
      const phaseStartedAt = Date.now();
      try {
        ctx.logger.info('Opening an SSH session for this job.');
        const workflowJobId = TurtleSshSession.getWorkflowJobIdOrThrow(ctx.env);
        const target = TurtleSshSession.getTurtleSshTarget({
          buildId,
          hasPlatform: Boolean(ctx.job.platform),
        });
        const { handle, idleTimeoutSeconds } = await TurtleSshSession.startSshSessionAsync(ctx, {
          target,
          relayServerUrl: TurtleSshSession.getSshRelayServerUrl(ctx.job),
          idleTimeoutSeconds: TurtleSshSession.getSshIdleTimeoutSeconds(ctx.job),
        });
        ctx.logger.info(`SSH session ready. Connect with: eas workflow:ssh ${workflowJobId}`);
        ctx.logger.info(
          idleTimeoutSeconds === 0
            ? 'It stays open for the whole job and closes once the job finishes and no client is connected.'
            : `It stays open for the whole job, then closes after ${TurtleSshSession.formatSshIdleTimeoutForLog(idleTimeoutSeconds)} with no client connected. The worker stays up until then.`
        );

        const sshLogger = logger.child({ phase: BuildPhase.SSH_SESSION });
        done = (async () => {
          let result = BuildPhaseResult.SUCCESS;
          try {
            await TurtleSshSession.superviseSshSessionAsync({
              getConnectedClientCount: () => handle.getConnectedClientCountAsync(),
              ensureConnected: () => handle.ensureConnectedAsync(),
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

  return { done };
}
