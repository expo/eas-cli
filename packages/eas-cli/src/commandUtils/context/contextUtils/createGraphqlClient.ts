import { Client, cacheExchange, createClient as createUrqlClient, fetchExchange } from '@urql/core';
import { retryExchange } from '@urql/exchange-retry';
import fetch, {
  RequestInfo as NodeFetchRequestInfo,
  RequestInit as NodeFetchRequestInit,
  Response as NodeFetchResponse,
} from 'node-fetch';

import { getExpoApiBaseUrl } from '../../../api';
import { httpsProxyAgent } from '../../../fetch';

// Extend the urql Client to allow for future customizations or type additions ahead of upstream type support.
export interface ExpoGraphqlClient extends Client {}

export function createGraphqlClient(
  authInfo: {
    accessToken: string | null;
    sessionSecret: string | null;
  },
  options: {
    /** Request timeout. Kept at the client level: a per-operation `fetchOptions` in urql would replace the auth headers. */
    requestTimeoutMs?: number;
  } = {}
): ExpoGraphqlClient {
  const { requestTimeoutMs } = options;
  // urql overwrites `fetchOptions.signal`, so the timeout must be added inside fetch.
  const fetchWithTimeoutAsync = async (
    url: NodeFetchRequestInfo,
    init?: NodeFetchRequestInit
  ): Promise<NodeFetchResponse> => {
    if (!requestTimeoutMs) {
      return await fetch(url, init);
    }
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal as AbortSignal] : []),
          timeoutSignal,
        ]),
      });
    } catch (error) {
      if (timeoutSignal.aborted) {
        const timeoutError = new Error(`Request timed out after ${requestTimeoutMs} ms`, {
          cause: error,
        });
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw error;
    }
  };

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
    fetch: fetchWithTimeoutAsync,
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
