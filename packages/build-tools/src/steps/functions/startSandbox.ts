import { SystemError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { graphql } from 'gql.tada';

import { CustomBuildContext } from '../../customBuildContext';
import { withLogPhaseAsync } from '../../utils/logPhase';
import { startSandboxDaemonAsync } from '../utils/sandboxDaemon';

const MARK_SANDBOX_READY_MUTATION = graphql(`
  mutation MarkSandboxReady($sandboxId: ID!) {
    sandbox {
      markSandboxReady(sandboxId: $sandboxId) {
        id
      }
    }
  }
`);

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
    fn: async (stepCtx, { inputs, signal }) => {
      const sandboxToken = ctx.env.__EAS_SANDBOX_MCP_TOKEN;
      if (!sandboxToken) {
        throw new SystemError('__EAS_SANDBOX_MCP_TOKEN is required to start the sandbox daemon.');
      }
      const mcpServerUrl = ctx.mcpServerUrl;
      if (!mcpServerUrl) {
        throw new SystemError('MCP server URL is required to start the sandbox daemon.');
      }
      const sandboxId = String(inputs.sandbox_id.value);
      const daemon = await startSandboxDaemonAsync({
        credential: sandboxToken,
        serverUrl: mcpServerUrl,
        reconnectDelayMs: RECONNECT_DELAY_MS,
        logger: stepCtx.logger,
        signal,
        workingDirectory: stepCtx.workingDirectory,
      });
      try {
        await daemon.ready;
        signal?.throwIfAborted();
        await markSandboxReadyAsync(ctx, sandboxId, signal);
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

export async function markSandboxReadyAsync(
  ctx: CustomBuildContext,
  sandboxId: string,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const result = await ctx.graphqlClient
    .mutation(
      MARK_SANDBOX_READY_MUTATION,
      { sandboxId },
      signal
        ? {
            fetch: (input, init) =>
              fetch(input, {
                ...init,
                signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
              }),
          }
        : undefined
    )
    .toPromise();
  signal?.throwIfAborted();
  if (result.error) {
    throw new SystemError(`Failed to mark sandbox ${sandboxId} as ready.`, {
      cause: result.error,
    });
  }
}

async function waitForCancellationAsync(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>(resolve => {
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });
}
