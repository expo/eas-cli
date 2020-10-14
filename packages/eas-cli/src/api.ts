import { createClient as createUrqlClient } from '@urql/core';
import got, { NormalizedOptions } from 'got';
import fetch from 'node-fetch';

import { getAccessToken, getSessionSecret } from './user/User';

type AccessTokenHeaders = {
  authorization: string;
};

type SessionHeaders = {
  'expo-session': string;
};

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

export const graphqlClient = createUrqlClient({
  url: getExpoApiBaseUrl() + '/--/graphql',
  // @ts-expect-error Type 'typeof fetch' is not assignable to type '(input: RequestInfo, init?: RequestInit | undefined) => Promise<Response>'.
  fetch,
  fetchOptions: (): { headers?: AccessTokenHeaders | SessionHeaders } => {
    const token = getAccessToken();
    if (token) {
      return {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };
    }
    const sessionSecret = getSessionSecret();
    if (sessionSecret) {
      return {
        headers: {
          'expo-session': sessionSecret,
        },
      };
    }
    return {};
  },
});

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
