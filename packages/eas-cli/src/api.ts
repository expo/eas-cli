import { JSONValue } from '@expo/json-file';
import got, { HTTPError, NormalizedOptions } from 'got';

import { getAccessToken, getSessionSecret } from './user/sessionStorage';

export const apiClient = got.extend({
  prefixUrl: getExpoApiBaseUrl() + '/--/api/v2/',
  hooks: {
    beforeRequest: [
      (options: NormalizedOptions) => {
        const token = getAccessToken();
        if (token) {
          options.headers.authorization = `Bearer ${token}`;
          return;
        }
        const sessionSecret = getSessionSecret();
        if (sessionSecret) {
          options.headers['expo-session'] = sessionSecret;
        }
      },
    ],
  },
});

export class ApiV2Error extends Error {
  readonly name = 'ApiV2Error';
  readonly code: string;
  readonly details?: JSONValue;
  readonly serverStack?: string;
  readonly metadata?: object;

  constructor(response: {
    message: string;
    code: string;
    stack?: string;
    details?: JSONValue;
    metadata?: object;
  }) {
    super(response.message);
    this.code = response.code;
    this.serverStack = response.stack;
    this.details = response.details;
    this.metadata = response.metadata;
  }
}

export async function apiV2PostAsync<T>(
  path: string,
  params: {
    [key: string]: any;
  }
): Promise<T> {
  try {
    return await apiClient.post(path, { json: params }).json<T>();
  } catch (e) {
    if (e instanceof HTTPError) {
      let result: { [key: string]: any };
      try {
        result = JSON.parse(e.response.body as string);
      } catch (e2) {
        throw e;
      }
      if (result.errors && result.errors.length) {
        throw new ApiV2Error(result.errors[0]);
      }
    }

    throw e;
  }
}

export function getExpoApiBaseUrl(): string {
  if (process.env.EXPO_STAGING) {
    return `https://staging.exp.host`;
  } else if (process.env.EXPO_LOCAL) {
    return `http://127.0.0.1:3000`;
  } else {
    return `https://exp.host`;
  }
}

export function getExpoWebsiteBaseUrl(): string {
  if (process.env.EXPO_STAGING) {
    return `https://staging.expo.io`;
  } else if (process.env.EXPO_LOCAL) {
    return `http://expo.test`;
  } else {
    return `https://expo.io`;
  }
}
