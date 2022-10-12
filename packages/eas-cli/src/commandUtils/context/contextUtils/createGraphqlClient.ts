import {
  Client,
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
import fetch from 'node-fetch';

import { getExpoApiBaseUrl } from '../../../api';
import { httpsProxyAgent } from '../../../fetch';
import { getAccessToken, getSessionSecret } from '../../../user/sessionStorage';

export interface ExpoGraphqlClient extends Client {
  // eslint-disable-next-line @typescript-eslint/ban-types
  query<Data = any, Variables extends object = {}>(
    query: DocumentNode | TypedDocumentNode<Data, Variables> | string,
    variables: Variables | undefined,
    context: Partial<OperationContext> & { additionalTypenames: string[] }
  ): PromisifiedSource<OperationResult<Data, Variables>>;
}

export function createGraphqlClient(): ExpoGraphqlClient {
  return createUrqlClient({
    url: getExpoApiBaseUrl() + '/graphql',
    exchanges: [
      dedupExchange,
      cacheExchange,
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
      const token = getAccessToken();
      if (token) {
        headers.authorization = `Bearer ${token}`;
      }
      const sessionSecret = getSessionSecret();
      if (!token && sessionSecret) {
        headers['expo-session'] = sessionSecret;
      }
      return {
        ...(httpsProxyAgent ? { agent: httpsProxyAgent } : {}),
        headers,
      };
    },
  }) as ExpoGraphqlClient;
}
