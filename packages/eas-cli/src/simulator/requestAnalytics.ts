import { Errors } from '@oclif/core';
import { CombinedError } from '@urql/core';

import { Analytics, AnalyticsEventProperties, SimulatorEvent } from '../analytics/AnalyticsManager';

/** The same value www stores in the session's `request_origin` tracking tag for eas-cli requests. */
export const SIMULATOR_REQUEST_ORIGIN = 'eas-cli';

export type SimulatorRequestFailureReason = 'network_error' | 'timeout';

const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

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
 * arrives. Ctrl+C exits with code 130 after the command's normal analytics flush.
 */
export async function withSimulatorRequestAnalyticsAsync<T>(
  analytics: Analytics,
  properties: AnalyticsEventProperties,
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
      Errors.exit(130);
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
