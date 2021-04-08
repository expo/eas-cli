import {
  CombinedError as GraphqlError,
  OperationResult,
  createClient as createUrqlClient,
} from '@urql/core';
import fetch from 'node-fetch';

import { getExpoApiBaseUrl } from '../api';
import Log from '../log';
import { getAccessToken, getSessionSecret } from '../user/sessionStorage';

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

export async function withErrorHandlingAsync<T>(promise: Promise<OperationResult<T>>): Promise<T> {
  const { data, error } = await promise;

  if (error) {
    if (error.graphQLErrors.some(e => e?.extensions?.isTransient)) {
      Log.error(`We've encountered a transient error, please try again shortly.`);
    }
    throw error;
  }

  // Check for malfolmed response. This only checks the root query existence,
  // It doesn't affect returning responses with empty resultset.
  if (!data) {
    throw new Error('Returned query result data is null!');
  }

  return data;
}

export { GraphqlError };
