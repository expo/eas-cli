import {
  AnyVariables,
  Client,
  OperationContext,
  OperationResult,
  OperationResultSource,
  TypedDocumentNode,
  createClient as createUrqlClient,
  cacheExchange as defaultCacheExchange,
  fetchExchange,
} from '@urql/core';
import { cacheExchange as graphqlCacheExchange } from '@urql/exchange-graphcache';
import { relayPagination } from '@urql/exchange-graphcache/extras';
import { retryExchange } from '@urql/exchange-retry';
import { DocumentNode } from 'graphql';
import fetch from 'node-fetch';

import { getExpoApiBaseUrl } from '../../../api';
import { httpsProxyAgent } from '../../../fetch';

export interface ExpoGraphqlClient extends Client {
  query<Data = any, Variables extends AnyVariables = AnyVariables>(
    query: DocumentNode | TypedDocumentNode<Data, Variables> | string,
    variables: Variables,
    context: Partial<OperationContext> & { additionalTypenames: string[] }
  ): OperationResultSource<OperationResult<Data, Variables>>;
}

// TODO: plumb this down, maybe use a feature gate for this?
export function createGraphqlClient(
  authInfo: {
    accessToken: string | null;
    sessionSecret: string | null;
  },
  _options: { useGraphqlCachePolicy?: boolean } = {}
): ExpoGraphqlClient {
  return createUrqlClient({
    url: getExpoApiBaseUrl() + '/graphql',
    exchanges: [
      //options.useGraphqlCachePolicy ? graphqlCacheExchange() : defaultCacheExchange,
      graphqlCacheExchange({
        resolvers: {
          App: {
            updateChannels: relayPagination(),
          },
        },
      }),
      retryExchange({
        maxDelayMs: 4000,
        retryIf: (err, operation) => {
          return !!(
            err &&
            !operation.context.noRetry &&
            (err.networkError || err.graphQLErrors.some(e => e?.extensions?.isTransient))
          );
        },
      }),
      fetchExchange,
    ],
    // @ts-expect-error Type 'typeof fetch' is not assignable to type '(input: RequestInfo, init?: RequestInit | undefined) => Promise<Response>'.
    fetch,
    fetchOptions: (): RequestInit => {
      const headers: Record<string, string> = {};
      if (authInfo.accessToken) {
        headers.authorization = `Bearer ${authInfo.accessToken}`;
      } else if (authInfo.sessionSecret) {
        headers['expo-session'] = authInfo.sessionSecret;
      }
      return {
        ...(httpsProxyAgent ? { agent: httpsProxyAgent } : {}),
        headers,
      };
    },
  }) as ExpoGraphqlClient;
}
