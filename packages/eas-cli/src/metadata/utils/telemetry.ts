import { App, Session, getRequestClient } from '@expo/apple-utils';
import type { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';

import { Analytics, MetadataEvent } from '../../analytics/events';
import { MetadataTelemetryError } from '../errors';

export type TelemetryContext = {
  app: App;
  auth: Partial<Session.AuthState>;
};

export async function withTelemetryAsync<T>(
  event: MetadataEvent,
  options: TelemetryContext,
  action: () => Promise<T>
): Promise<T> {
  const executionId = uuidv4();
  const scrubber = makeDataScrubber(options);
  const { interceptors } = getRequestClient();

  const responseInterceptorId = interceptors.response.use(
    response => {
      Analytics.logEvent(event, {
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
      Analytics.logEvent(event, {
        executionId,
        type: 'response',
        phase: 'rejected',
        method: error.request.method.toUpperCase(),
        url: scrubber(error.config.url),
        error: scrubber(error.message),
        status: String(error.response?.status),
        statusText: scrubber(error.response?.statusText),
        input: scrubber(error.config.data),
        output: scrubber(error.response?.data),
      });

      throw error;
    }
  );

  try {
    return await action();
  } catch (error: any) {
    throw new MetadataTelemetryError(error, executionId);
  } finally {
    interceptors.response.eject(responseInterceptorId);
  }
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
