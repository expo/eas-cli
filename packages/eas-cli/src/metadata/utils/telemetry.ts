import { App, Session, getRequestClient } from '@expo/apple-utils';
import type { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';

import { Analytics, MetadataEvent } from '../../analytics/AnalyticsManager';
import escapeRegExp from '../../utils/expodash/escapeRegExp';

export type TelemetryContext = {
  app: App;
  auth: Partial<Session.AuthState>;
};

/**
 * Subscribe the telemetry to the ongoing metadata requests and responses.
 * When providing the app and auth info, we can scrub that data from the telemetry.
 * Returns an execution ID to group all events of a single run together, and a unsubscribe function.
 */
export async function subscribeTelemetryAsync(
  analytics: Analytics,
  event: MetadataEvent,
  options: TelemetryContext
): Promise<{
  /** Unsubscribe the telemetry from all apple-utils events */
  unsubscribeTelemetry: () => void;
  /** The unique id added to all telemetry events from a single execution */
  executionId: string;
}> {
  const executionId = uuidv4();
  const scrubber = await makeDataScrubberAsync(options);
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
export async function makeDataScrubberAsync({
  app,
  auth,
}: TelemetryContext): Promise<<T>(data: T) => string> {
  const token = await getAuthTokenStringAsync(auth);
  const patterns: Record<string, RegExp | null> = {
    APPLE_APP_ID: literalPattern(app.id),
    APPLE_USERNAME: literalPattern(auth.username),
    APPLE_PASSWORD: literalPattern(auth.password),
    APPLE_TOKEN: literalPattern(token),
    APPLE_TEAM_ID: literalPattern(auth.context?.teamId),
    APPLE_PROVIDER_ID: literalPattern(auth.context?.providerId),
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

/**
 * A pattern matching the value itself, and nothing else.
 *
 * The values scrubbed here are chosen by the user, so they routinely contain characters that mean
 * something in a pattern. Left unescaped, an Apple ID like `user+eas@icloud.com` or a password like
 * `p+ssw0rd` is not matched by the pattern built from it and reaches the telemetry unscrubbed, and
 * one containing `(` or `[` makes `new RegExp` throw before the first request goes out.
 */
function literalPattern(value: string | number | null | undefined): RegExp | null {
  return value || value === 0 ? new RegExp(escapeRegExp(String(value)), 'gi') : null;
}

async function getAuthTokenStringAsync(auth: TelemetryContext['auth']): Promise<string | null> {
  if (!auth.context?.token) {
    return null;
  }

  if (typeof auth.context.token === 'object') {
    return await auth.context.token.getToken();
  }

  return auth.context.token;
}
