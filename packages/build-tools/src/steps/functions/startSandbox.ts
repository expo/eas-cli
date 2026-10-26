import { SystemError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
import { withLogPhaseAsync } from '../../utils/logPhase';
import {
  SandboxWorkerApi,
  getSandboxCommandEnv,
  getSandboxWorkerTokenFromEnvironmentSecrets,
} from '../utils/sandboxWorkerApi';
import { startSandboxDaemonAsync } from '../utils/sandboxDaemon';

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
    ],
    fn: async (stepCtx, { signal, env }) => {
      const sandboxToken = getSandboxWorkerTokenFromEnvironmentSecrets(
        ctx.job.secrets?.environmentSecrets
      );
      if (!sandboxToken) {
        throw new SystemError(
          'Sandbox worker token is missing. Check the worker configuration and start a new sandbox.'
        );
      }
      if (!ctx.expoApiV2BaseUrl) {
        throw new SystemError(
          'Sandbox worker API URL is missing. Check the worker configuration and start a new sandbox.'
        );
      }
      const workerApi = new SandboxWorkerApi(ctx.expoApiV2BaseUrl, sandboxToken);
      const mcpServerUrl = ctx.mcpServerUrl;
      if (!mcpServerUrl) {
        throw new SystemError('MCP server URL is required to start the sandbox daemon.');
      }
      const daemon = await startSandboxDaemonAsync({
        credential: sandboxToken,
        serverUrl: mcpServerUrl,
        reconnectDelayMs: RECONNECT_DELAY_MS,
        logger: stepCtx.logger,
        signal,
        workingDirectory: stepCtx.workingDirectory,
        env: getSandboxCommandEnv(env),
        workerApi,
      });
      try {
        await daemon.ready;
        signal?.throwIfAborted();
        await workerApi.markReadyAsync(signal);
        signal?.throwIfAborted();
        stepCtx.logger.info('Sandbox daemon started.');

        await withLogPhaseAsync(stepCtx.logger, AWAIT_SANDBOX_STEP_NAME, async () => {
          await waitForCancellationAsync(signal);
        });
      } finally {
        await daemon.stopAsync();
      }
    },
  });
}

async function waitForCancellationAsync(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>(resolve => {
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });
}
