import { CombinedError } from '@urql/core';

import {
  AnalyticsEventProperties,
  AnalyticsWithOrchestration,
  SimulatorEvent,
} from '../analytics/AnalyticsManager';
import Log from '../log';
import { Ora } from '../ora';
import { sleepAsync } from '../utils/promise';

/** Matches www's `request_origin` value for eas-cli, though this CLI does not send it to www yet. */
export const SIMULATOR_REQUEST_ORIGIN = 'eas-cli';

export type SimulatorRequestFailureReason = 'network_error' | 'timeout';

const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

/**
 * How long Ctrl+C waits for analytics to flush. The analytics client has no request timeout, so
 * without a limit a hung network would make Ctrl+C look ignored.
 */
const CANCEL_FLUSH_TIMEOUT_MS = 1_000;

/**
 * How long Ctrl+C then waits for the create request. The server can still create the session after
 * the client stops waiting, and nothing else stops that session before its maximum duration.
 */
const CANCEL_CREATE_WAIT_MS = 5_000;

const SESSION_MAY_BE_RUNNING_WARNING =
  'A simulator session may still be running. Run `eas simulator:list` to check for a running session, and `eas simulator:stop --id <id>` to stop it.';

export function simulatorRequestProperties({
  projectId,
  type,
  platform,
  hasBuildId,
  hasArchiveUrl,
  expoGo,
  packageVersion,
  nonInteractive,
}: {
  projectId: string;
  type: string;
  platform: string;
  hasBuildId: boolean;
  hasArchiveUrl: boolean;
  expoGo: boolean;
  packageVersion?: string;
  nonInteractive: boolean;
}): AnalyticsEventProperties {
  return {
    project_id: projectId,
    origin: SIMULATOR_REQUEST_ORIGIN,
    type,
    platform: platform.toLowerCase(),
    has_build_id: hasBuildId,
    has_archive_url: hasArchiveUrl,
    expo_go: expoGo,
    ...(packageVersion ? { requested_package_version: packageVersion } : {}),
    non_interactive: nonInteractive,
  };
}

/**
 * Why the create request got no answer, or null when the server answered. A server refusal is
 * not a client failure: www reports it as an admission denial, so counting it here would count
 * the same attempt twice.
 */
export function simulatorRequestFailureReason(
  error: unknown
): SimulatorRequestFailureReason | null {
  if (!(error instanceof CombinedError) || !error.networkError || error.graphQLErrors.length > 0) {
    return null;
  }
  const networkError = error.networkError as Error & { code?: string; cause?: { code?: string } };
  const code = networkError.code ?? networkError.cause?.code;
  if (
    (code && TIMEOUT_CODES.has(code)) ||
    networkError.name === 'AbortError' ||
    networkError.name === 'TimeoutError'
  ) {
    return 'timeout';
  }
  return 'network_error';
}

class SimulatorRequestCancelledError extends Error {}

/**
 * Runs the create request and logs the client-side funnel events around it: "request sent" before
 * it leaves, "request cancelled" on Ctrl+C before an answer, and "request failed" when no answer
 * arrives. "Request cancelled" means the client stopped waiting; the server can still create the
 * session. So Ctrl+C stops the spinner, flushes analytics, and waits a bounded time for the
 * request: a session that comes back goes to `stopCreatedAsync`, and otherwise the user is told how
 * to check for one. Then it exits with 130, like the session's own Ctrl+C handler: going through
 * the command's error handling would print the exit as an error and report it to Sentry. A second
 * Ctrl+C exits at once.
 */
export async function withSimulatorRequestAnalyticsAsync<T>(
  analytics: AnalyticsWithOrchestration,
  properties: AnalyticsEventProperties,
  spinner: Ora,
  createAsync: () => Promise<T>,
  stopCreatedAsync: (created: T) => Promise<void>
): Promise<T> {
  let cancelRequested = false;
  let onSigint: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onSigint = () => {
      if (cancelRequested) {
        Log.warn(SESSION_MAY_BE_RUNNING_WARNING);
        process.exit(130);
      }
      cancelRequested = true;
      reject(new SimulatorRequestCancelledError());
    };
  });
  process.on('SIGINT', onSigint!);
  analytics.logEvent(SimulatorEvent.REQUEST_SENT, properties);
  let createPromise: Promise<T> | undefined;
  try {
    createPromise = createAsync();
    return await Promise.race([createPromise, cancelled]);
  } catch (error) {
    if (error instanceof SimulatorRequestCancelledError) {
      analytics.logEvent(SimulatorEvent.REQUEST_CANCELLED, { ...properties, reason: 'user_abort' });
      spinner.fail('Simulator session request canceled');
      const flushTimeout = new AbortController();
      await Promise.race([
        analytics.flushAsync(),
        sleepAsync(CANCEL_FLUSH_TIMEOUT_MS, flushTimeout.signal),
      ]);
      flushTimeout.abort();
      await stopSessionCreatedAfterCancelAsync(createPromise!, stopCreatedAsync);
      process.exit(130);
    }
    const reason = simulatorRequestFailureReason(error);
    if (reason) {
      analytics.logEvent(SimulatorEvent.REQUEST_FAILED, { ...properties, reason });
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', onSigint!);
  }
}

async function stopSessionCreatedAfterCancelAsync<T>(
  createPromise: Promise<T>,
  stopCreatedAsync: (created: T) => Promise<void>
): Promise<void> {
  Log.log(
    `Waiting up to ${CANCEL_CREATE_WAIT_MS / 1_000} seconds for the request to finish, so a session it created can be stopped. Press Ctrl+C again to exit now.`
  );
  const waitTimeout = new AbortController();
  const created = await Promise.race([
    createPromise.then(
      value => ({ value }),
      () => undefined
    ),
    sleepAsync(CANCEL_CREATE_WAIT_MS, waitTimeout.signal).then(() => undefined),
  ]);
  waitTimeout.abort();
  if (created) {
    await stopCreatedAsync(created.value);
  } else {
    Log.warn(SESSION_MAY_BE_RUNNING_WARNING);
  }
}
