import { SystemError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { graphql } from 'gql.tada';
import { z } from 'zod';

import { CustomBuildContext } from '../../customBuildContext';
import { graphqlAbortContext } from '../../utils/graphqlAbort';
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
const MaxDurationSecondsZ = z.number().positive().optional();

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
      // The daemon needs this credential, but shell commands do not.
      const { __EAS_SANDBOX_MCP_TOKEN: sandboxToken, ...commandEnv } = env;
      if (!sandboxToken) {
        throw new SystemError('__EAS_SANDBOX_MCP_TOKEN is required to start the sandbox daemon.');
      }
      const mcpServerUrl = ctx.mcpServerUrl;
      if (!mcpServerUrl) {
        throw new SystemError('MCP server URL is required to start the sandbox daemon.');
      }
      const sandboxId = String(inputs.sandbox_id.value);
      const durationResult = MaxDurationSecondsZ.safeParse(inputs.max_duration_seconds?.value);
      if (!durationResult.success) {
        throw new SystemError(
          `Invalid sandbox maximum duration: ${String(inputs.max_duration_seconds?.value)}. Provide a finite number greater than zero, or omit max_duration_seconds.`,
          { cause: durationResult.error }
        );
      }
      const maxDurationSeconds = durationResult.data;
      const daemon = await startSandboxDaemonAsync({
        credential: sandboxToken,
        serverUrl: mcpServerUrl,
        reconnectDelayMs: RECONNECT_DELAY_MS,
        logger: stepCtx.logger,
        signal,
        workingDirectory: stepCtx.workingDirectory,
        env: commandEnv,
        graphqlClient: ctx.graphqlClient,
        sandboxId,
      });
      try {
        await daemon.ready;
        signal?.throwIfAborted();
        await markSandboxReadyAsync(ctx, sandboxId, signal);
        signal?.throwIfAborted();
        stepCtx.logger.info('Sandbox daemon started.');

        await withLogPhaseAsync(stepCtx.logger, AWAIT_SANDBOX_STEP_NAME, async () => {
          const timeoutController = new AbortController();
          const timeout =
            maxDurationSeconds === undefined
              ? undefined
              : setTimeout(() => timeoutController.abort(), maxDurationSeconds * 1000);
          try {
            await waitForCompletionAsync(
              signal
                ? AbortSignal.any([signal, timeoutController.signal])
                : timeoutController.signal
            );
            if (timeoutController.signal.aborted) {
              stepCtx.logger.info(
                `Sandbox reached its maximum runtime of ${maxDurationSeconds} seconds. Stopping.`
              );
            }
          } finally {
            clearTimeout(timeout);
          }
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
    .mutation(MARK_SANDBOX_READY_MUTATION, { sandboxId }, graphqlAbortContext(signal))
    .toPromise();
  signal?.throwIfAborted();
  if (result.error) {
    throw new SystemError(`Failed to mark sandbox ${sandboxId} as ready.`, {
      cause: result.error,
    });
  }
}

async function waitForCompletionAsync(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>(resolve => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
