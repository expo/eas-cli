import { ArchiveSourceType, SystemError, UserError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';

import { stripRepositoryCredentialsAsync } from '../../common/git';
import { CustomBuildContext } from '../../customBuildContext';
import { withLogPhaseAsync } from '../../utils/logPhase';
import { startSandboxDaemonAsync } from '../utils/sandboxDaemon';
import { requireSandboxWorkerApi } from '../utils/sandboxWorkerApi';

const RECONNECT_DELAY_MS = 1_000;
const AWAIT_SANDBOX_STEP_NAME = 'Await sandbox completion';

export function createStartSandboxBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_sandbox',
    name: 'Start sandbox daemon',
    __metricsId: 'eas/start_sandbox',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'sandbox_id',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'max_duration_seconds',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
    ],
    fn: async (stepCtx, { inputs, signal, env }) => {
      const workerApi = requireSandboxWorkerApi(ctx);
      const mcpServerUrl = ctx.mcpServerUrl;
      if (!mcpServerUrl) {
        throw new SystemError('MCP server URL is required to start the sandbox daemon.');
      }
      const maxDurationSeconds = inputs.max_duration_seconds?.value;
      if (
        maxDurationSeconds !== undefined &&
        (typeof maxDurationSeconds !== 'number' ||
          !Number.isFinite(maxDurationSeconds) ||
          maxDurationSeconds <= 0)
      ) {
        throw new UserError(
          'EAS_SANDBOX_INVALID_DURATION',
          `Invalid sandbox maximum duration: ${String(maxDurationSeconds)}. Provide a finite number greater than zero, or omit max_duration_seconds.`
        );
      }
      if (ctx.job.projectArchive.type === ArchiveSourceType.GIT) {
        // The agent must not be able to read the repository access token.
        await stripRepositoryCredentialsAsync({
          repositoryDirectory: stepCtx.global.wasCheckedOut()
            ? ctx.projectTargetDirectory
            : ctx.projectSourceDirectory,
        });
      }

      const daemon = await startSandboxDaemonAsync({
        credential: workerApi.token,
        serverUrl: mcpServerUrl,
        reconnectDelayMs: RECONNECT_DELAY_MS,
        logger: stepCtx.logger,
        signal,
        workingDirectory: stepCtx.workingDirectory,
        env,
        workerApi,
      });
      try {
        await daemon.ready;
        signal?.throwIfAborted();
        await workerApi.markReadyAsync({ signal }).catch((error: unknown) => {
          signal?.throwIfAborted();
          throw new SystemError(
            `Failed to mark sandbox ${String(inputs.sandbox_id.value)} as ready.`,
            { cause: error }
          );
        });
        signal?.throwIfAborted();
        stepCtx.logger.info('Sandbox daemon started.');

        await withLogPhaseAsync(stepCtx.logger, AWAIT_SANDBOX_STEP_NAME, async () => {
          const timeoutSignal =
            maxDurationSeconds === undefined
              ? undefined
              : AbortSignal.timeout(Math.ceil(maxDurationSeconds * 1000));
          await waitForCompletionAsync(
            AbortSignal.any([
              ...(signal ? [signal] : []),
              ...(timeoutSignal ? [timeoutSignal] : []),
            ])
          );
          if (timeoutSignal?.aborted) {
            stepCtx.logger.info(
              `Sandbox reached its maximum runtime of ${maxDurationSeconds} seconds. Stopping.`
            );
          }
        });
      } finally {
        await daemon.stopAsync();
      }
    },
  });
}

async function waitForCompletionAsync(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>(resolve => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
