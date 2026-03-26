import { Client, cacheExchange, createClient as createUrqlClient, fetchExchange } from '@urql/core';
import { retryExchange } from '@urql/exchange-retry';
import fetch from 'node-fetch';

import { getExpoApiBaseUrl } from '../../../api';
import { httpsProxyAgent } from '../../../fetch';

// Extend the urql Client to allow for future customizations or type additions ahead of upstream type support.
export interface ExpoGraphqlClient extends Client {}

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
