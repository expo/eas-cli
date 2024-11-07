import {
  AnyVariables,
  Client,
  OperationContext,
  OperationResult,
  OperationResultSource,
  TypedDocumentNode,
  cacheExchange,
  createClient as createUrqlClient,
  fetchExchange,
} from '@urql/core';
import { retryExchange } from '@urql/exchange-retry';
import { DocumentNode } from 'graphql';

import { getExpoApiBaseUrl } from '../../../api';
import fetch, { RequestError, RequestInfo, RequestInit } from '../../../fetch';

export interface ExpoGraphqlClient extends Client {
  query<Data = any, Variables extends AnyVariables = AnyVariables>(
    query: DocumentNode | TypedDocumentNode<Data, Variables> | string,
    variables: Variables,
    context: Partial<OperationContext> & { additionalTypenames: string[] }
  ): OperationResultSource<OperationResult<Data, Variables>>;
}

export function createGraphqlClient(authInfo: {
  accessToken: string | null;
  sessionSecret: string | null;
}): ExpoGraphqlClient {
  return createUrqlClient({
    url: getExpoApiBaseUrl() + '/graphql',
    exchanges: [
      cacheExchange,
      retryExchange({
        maxDelayMs: 4000,
        retryIf: (err, operation) => {
          return !!(
            err &&
            !operation.context.noRetry &&
            (err.networkError ?? err.graphQLErrors.some(e => e?.extensions?.isTransient))
          );
        },
      }),
      fetchExchange,
    ],
    // @ts-expect-error - Type '(url: RequestInfo, init?: RequestInit) => Promise<Response>' is not assignable to type '{ (input: RequestInfo | URL, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<...>; }'.
    fetch: (url: RequestInfo, init?: RequestInit) =>
      fetch(url, init).catch((error: RequestError) => error.response),
    fetchOptions: () => {
      const headers: Record<string, string> = {};
      if (authInfo.accessToken) {
        headers.authorization = `Bearer ${authInfo.accessToken}`;
      } else if (authInfo.sessionSecret) {
        headers['expo-session'] = authInfo.sessionSecret;
      }
      return { headers };
    },
  }) as ExpoGraphqlClient;
}
