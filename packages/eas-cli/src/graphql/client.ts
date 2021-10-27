import {
  Client,
  CombinedError as GraphqlError,
  OperationContext,
  OperationResult,
  PromisifiedSource,
  TypedDocumentNode,
  cacheExchange,
  createClient as createUrqlClient,
  dedupExchange,
  fetchExchange,
} from '@urql/core';
import { retryExchange } from '@urql/exchange-retry';
import { DocumentNode } from 'graphql';
// node-fetch is used here because @urql/core uses the fetch API under the hood
// don't use node-fetch elsewhere
// eslint-disable-next-line
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
  exchanges: [
    dedupExchange,
    cacheExchange,
    retryExchange({
      maxDelayMs: 4000,
      retryIf: err =>
        !!(err && (err.networkError || err.graphQLErrors.some(e => e?.extensions?.isTransient))),
    }),
    fetchExchange,
  ],
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
}) as StricterClient;

/* Please specify additionalTypenames in your Graphql queries */
export interface StricterClient extends Client {
  // eslint-disable-next-line @typescript-eslint/ban-types
  query<Data = any, Variables extends object = {}>(
    query: DocumentNode | TypedDocumentNode<Data, Variables> | string,
    variables: Variables | undefined,
    context: Partial<OperationContext> & { additionalTypenames: string[] }
  ): PromisifiedSource<OperationResult<Data, Variables>>;
}

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
