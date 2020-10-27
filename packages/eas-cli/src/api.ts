import got, { NormalizedOptions } from 'got';

import { getAccessToken, getSessionSecret } from './user/User';

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
