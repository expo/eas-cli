import got, { HTTPError, NormalizedOptions, RequestError } from 'got';

import ApiV2Error from './ApiV2Error';
import { getAccessToken, getSessionSecret } from './user/sessionStorage';

export const apiClient = got.extend({
  prefixUrl: `${getExpoApiBaseUrl()}/--/api/v2/`,
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
    beforeError: [
      (error: RequestError): RequestError => {
        if (error instanceof HTTPError) {
          let result: { [key: string]: any };
          try {
            result = JSON.parse(error.response.body as string);
          } catch (e2) {
            return error;
          }
          if (result.errors?.length) {
            return new ApiV2Error(error, result.errors[0]);
          }
        }
        return error;
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
    return `https://staging.expo.dev`;
  } else if (process.env.EXPO_LOCAL) {
    return `http://expo.test`;
  } else {
    return `https://expo.dev`;
  }
}
