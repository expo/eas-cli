import fetch, { Response, RequestInit, HeaderInit } from 'node-fetch';
import { bunyan } from '@expo/logger';

import { retryAsync } from './retry';

type TurtleFetchMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'TRACE' | 'PATCH';

export class TurtleFetchError extends Error {
  readonly response: Response;
  constructor(message: string, response: Response) {
    super(message);
    this.response = response;
  }
}

/**
 * Wrapper around node-fetch adding some useful features:
 * - retries
 * - json body - if you specify json in options, it will be stringified and content-type will be set to application/json
 * - automatic error throwing - if response is not ok, it will throw an error
 *
 * @param url URL to fetch
 * @param method HTTP method
 * @param options.retries number of retries
 * @param options.json json body
 * @param options.headers headers
 * @param options.shouldThrowOnNotOk if false, it will not throw an error if response is not ok (default: true)
 * @param options other options passed to node-fetch
 * @returns {Promise<Response>}
 */
export async function turtleFetch(
  url: string,
  method: TurtleFetchMethod,
  options: Omit<RequestInit, 'body' | 'method'> & {
    retries?: number;
    json?: Record<string, any>;
    headers?: Exclude<HeaderInit, string[][]>;
    shouldThrowOnNotOk?: boolean;
    retryIntervalMs?: number;
    logger?: bunyan;
  }
): Promise<Response> {
  const {
    json,
    headers: rawHeaders,
    retries: rawRetries,
    logger,
    retryIntervalMs = 1000,
    shouldThrowOnNotOk = true,
    ...otherOptions
  } = options;

  const retries = rawRetries ?? (method === 'POST' ? 0 : 2);

  const body = JSON.stringify(json);
  const headers = json ? { ...rawHeaders, 'Content-Type': 'application/json' } : rawHeaders;

  return await retryAsync(
    async (attemptCount) => {
      const response = await fetch(url, {
        method,
        body,
        headers,
        ...otherOptions,
      });
      const shouldThrow = shouldThrowOnNotOk || attemptCount < retries;
      if (!response.ok && shouldThrow) {
        throw new TurtleFetchError(`Request failed with status ${response.status}`, response);
      }
      return response;
    },
    { retryOptions: { retries, retryIntervalMs }, logger }
  );
}
