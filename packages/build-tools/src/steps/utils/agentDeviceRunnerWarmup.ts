import { type bunyan } from '@expo/logger';
import fetch from 'node-fetch';

import { Sentry } from '../../sentry';

// One runner start measured about 22 s on an EAS iOS worker (connect + health check).
// Keep a wide margin: an aborted request can make the daemon abort the runner start.
const PREPARE_IOS_RUNNER_TIMEOUT_MS = 180_000;

type PrepareIosRunnerRpcResponse = {
  result?: {
    ok?: boolean;
    data?: { durationMs?: number; cache?: string };
    error?: { code?: string; message?: string };
  };
  error?: { code?: number; message?: string };
};

/**
 * Starts the agent-device XCTest runner in the session daemon, so the first remote
 * `open` / `snapshot` does not pay the runner startup cost.
 *
 * It must go to the same daemon that serves remote clients: the runner is held in
 * that daemon's memory and a runner lease blocks other daemons. The daemon queues
 * runner starts per device, so a client command that arrives during the warm-up
 * waits for it and reuses the runner.
 *
 * Never throws. A failed warm-up only means the first client command starts the runner.
 */
export async function warmUpAgentDeviceIosRunnerAsync({
  daemonUrl,
  daemonToken,
  logger,
}: {
  daemonUrl: string;
  daemonToken: string;
  logger: bunyan;
}): Promise<void> {
  const startedAt = Date.now();
  try {
    const response = await fetch(new URL('/rpc', daemonUrl).toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemonToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'eas-prepare-ios-runner',
        method: 'agent_device.command',
        params: {
          session: 'eas-runner-warmup',
          command: 'prepare',
          positionals: ['ios-runner'],
          flags: { platform: 'ios' },
        },
      }),
      signal: AbortSignal.timeout(PREPARE_IOS_RUNNER_TIMEOUT_MS),
    });
    const body = (await response.json()) as PrepareIosRunnerRpcResponse;
    const errorMessage =
      body.error?.message ??
      (body.result?.ok === false ? (body.result.error?.message ?? 'unknown error') : undefined);
    if (!response.ok || errorMessage) {
      throw new Error(
        `agent-device prepare ios-runner failed (${response.status}): ${errorMessage ?? response.statusText}`
      );
    }
    const data = body.result?.data;
    logger.info(
      `Prepared agent-device iOS runner in ${Date.now() - startedAt} ms` +
        ` (daemon: ${data?.durationMs ?? 'unknown'} ms, runner cache: ${data?.cache ?? 'unknown'}).`
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not warm up the agent-device iOS runner', error, {
      level: 'warning',
      tags: { phase: 'agent-device-ios-runner-warmup' },
      extras: { elapsedMs: Date.now() - startedAt },
    });
    logger.warn(
      { err: error },
      'Could not warm up the agent-device iOS runner; the first remote command will start it.'
    );
  }
}
