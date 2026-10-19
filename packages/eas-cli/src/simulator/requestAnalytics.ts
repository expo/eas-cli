import { CombinedError } from '@urql/core';

import { AnalyticsEventProperties } from '../analytics/AnalyticsManager';

/** Matches www's `request_origin` value for eas-cli, though this CLI does not send it to www yet. */
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
