import { App, Session, getRequestClient } from '@expo/apple-utils';
import type { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';

import { Analytics, MetadataEvent } from '../../analytics/AnalyticsManager';

export type TelemetryContext = {
  app: App;
  auth: Partial<Session.AuthState>;
};

/**
 * Subscribe the telemetry to the ongoing metadata requests and responses.
 * When providing the app and auth info, we can scrub that data from the telemetry.
 * Returns an execution ID to group all events of a single run together, and a unsubscribe function.
 */
export function subscribeTelemetry(
  analytics: Analytics,
  event: MetadataEvent,
  options: TelemetryContext
): {
  /** Unsubscribe the telemetry from all apple-utils events */
  unsubscribeTelemetry: () => void;
  /** The unique id added to all telemetry events from a single execution */
  executionId: string;
} {
  const executionId = uuidv4();
  const scrubber = makeDataScrubber(options);
  const { interceptors } = getRequestClient();

  const responseInterceptorId = interceptors.response.use(
    response => {
      analytics.logEvent(event, {
        executionId,
        type: 'response',
        phase: 'resolved',
        method: response.request.method.toUpperCase(),
        url: scrubber(response.request.path),
        status: String(response.status),
        statusText: scrubber(response.statusText),
      });

      return response;
    },
    (error: AxiosError) => {
      analytics.logEvent(event, {
        executionId,
        type: 'response',
        phase: 'rejected',
        method: error.request.method.toUpperCase(),
        url: scrubber(error.config?.url),
        error: scrubber(error.message),
        status: String(error.response?.status),
        statusText: scrubber(error.response?.statusText),
        input: scrubber(error.config?.data),
        output: scrubber(error.response?.data),
      });

      throw error;
    }
  );

  function unsubscribeTelemetry(): void {
    interceptors.response.eject(responseInterceptorId);
  }

  return { unsubscribeTelemetry, executionId };
}

/** Exposed for testing */
export function makeDataScrubber({ app, auth }: TelemetryContext): <T>(data: T) => string {
  const token = getAuthTokenString(auth);
  const patterns: Record<string, RegExp | null> = {
    APPLE_APP_ID: new RegExp(app.id, 'gi'),
    APPLE_USERNAME: auth.username ? new RegExp(auth.username, 'gi') : null,
    APPLE_PASSWORD: auth.password ? new RegExp(auth.password, 'gi') : null,
    APPLE_TOKEN: token ? new RegExp(token, 'gi') : null,
    APPLE_TEAM_ID: auth.context?.teamId ? new RegExp(auth.context.teamId, 'gi') : null,
    APPLE_PROVIDER_ID: auth.context?.providerId
      ? new RegExp(String(auth.context.providerId), 'gi')
      : null,
  };

  const iterator = Object.entries(patterns);

  return function scrubber(data) {
    if (!data) {
      return String(data);
    }

    let value = typeof data === 'object' ? JSON.stringify(data) : String(data);
    for (const [replacement, pattern] of iterator) {
      if (pattern) {
        value = value.replace(pattern, `{${replacement}}`);
      }
    }
    return value;
  };
}

function getAuthTokenString(auth: TelemetryContext['auth']): string | null {
  if (!auth.context?.token) {
    return null;
  }

  if (typeof auth.context.token === 'object') {
    return auth.context.token.getToken();
  }

  return auth.context.token;
}
