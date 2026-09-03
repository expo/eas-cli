import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { graphql } from 'gql.tada';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { CustomBuildContext } from '../../customBuildContext';
import { withLogPhaseAsync } from '../../utils/logPhase';
import { startSandboxDaemonAsync } from '../utils/sandboxDaemon';

const SANDBOX_STATUS_QUERY = graphql(`
  query SandboxStatus($sandboxId: ID!) {
    sandboxes {
      byId(sandboxId: $sandboxId) {
        id
        status
      }
    }
  }
`);

const POLL_INTERVAL_MS = 5_000;
const RECONNECT_DELAY_MS = 1_000;
const MAX_CONSECUTIVE_POLL_FAILURES = 3;
const AWAIT_SANDBOX_STEP_NAME = 'Await sandbox completion';

type SandboxStatusQuery = {
  sandboxes: {
    byId: {
      status: string;
    } | null;
  };
};

type SandboxStatusQueryVariables = {
  sandboxId: string;
};

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
      });
      try {
        await daemon.ready;
        stepCtx.logger.info('Sandbox daemon started.');

        await withLogPhaseAsync(stepCtx.logger, AWAIT_SANDBOX_STEP_NAME, async phaseLogger => {
          await waitForSandboxStoppedAsync(ctx, {
            sandboxId,
            logger: phaseLogger,
            signal,
          });
        });
      } finally {
        await daemon.stopAsync();
      }
    },
  });
}

export async function waitForSandboxStoppedAsync(
  ctx: CustomBuildContext,
  {
    sandboxId,
    logger,
    signal,
    pollIntervalMs = POLL_INTERVAL_MS,
  }: {
    sandboxId: string;
    logger: bunyan;
    signal?: AbortSignal;
    pollIntervalMs?: number;
  }
): Promise<void> {
  logger.info(`Waiting for sandbox ${sandboxId} to stop.`);
  let consecutiveFailures = 0;
  while (!signal?.aborted) {
    try {
      const result = await ctx.graphqlClient
        .query<SandboxStatusQuery, SandboxStatusQueryVariables>(SANDBOX_STATUS_QUERY, { sandboxId })
        .toPromise();
      if (result.error) {
        throw result.error;
      }
      const status = result.data?.sandboxes.byId?.status;
      if (!status) {
        throw new Error(`Sandbox ${sandboxId} status response was missing.`);
      }
      consecutiveFailures = 0;
      if (status === 'STOPPED') {
        logger.info(`Sandbox ${sandboxId} was stopped.`);
        return;
      }
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new SystemError(
          `Could not poll sandbox status after ${consecutiveFailures} consecutive attempts.`,
          { cause: error }
        );
      }
      logger.warn(
        { err: error },
        `Could not poll sandbox status; will retry (${consecutiveFailures}/${MAX_CONSECUTIVE_POLL_FAILURES}).`
      );
    }
    try {
      await setTimeoutAsync(pollIntervalMs, undefined, signal ? { signal } : undefined);
    } catch (error) {
      if (!signal?.aborted) {
        throw new SystemError(`Waiting for sandbox ${sandboxId} failed.`, { cause: error });
      }
    }
  }
}
