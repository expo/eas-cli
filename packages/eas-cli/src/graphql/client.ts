import { CombinedError as GraphqlError, createClient as createUrqlClient } from '@urql/core';
import fetch from 'node-fetch';

import { getExpoApiBaseUrl } from '../api';
import { getAccessToken, getSessionSecret } from '../user/User';

type AccessTokenHeaders = {
  authorization: string;
};

type SessionHeaders = {
  'expo-session': string;
};

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

export { GraphqlError };
