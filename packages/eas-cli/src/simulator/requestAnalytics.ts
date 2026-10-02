import { CombinedError } from '@urql/core';

import {
  AnalyticsEventProperties,
  AnalyticsWithOrchestration,
  SimulatorEvent,
} from '../analytics/AnalyticsManager';
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
  // urql attaches the HTTP response to non-2xx answers too, such as a 504 from the load balancer.
  // An answer arrived, so www may have seen the request already.
  if (error.response) {
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
 * arrives. Ctrl+C stops the spinner, flushes analytics, and exits with 130, like the session's own
 * Ctrl+C handler: going through the command's error handling would print the exit as an error and
 * report it to Sentry.
 */
export async function withSimulatorRequestAnalyticsAsync<T>(
  analytics: AnalyticsWithOrchestration,
  properties: AnalyticsEventProperties,
  spinner: Ora,
  createAsync: () => Promise<T>
): Promise<T> {
  let onSigint: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onSigint = () => {
      reject(new SimulatorRequestCancelledError());
    };
  });
  process.once('SIGINT', onSigint!);
  analytics.logEvent(SimulatorEvent.REQUEST_SENT, properties);
  try {
    return await Promise.race([createAsync(), cancelled]);
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
