import { type Env, SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { FetchError } from 'node-fetch';
import { z } from 'zod';

import { promiseRetryWithCondition } from '../../utils/promiseRetryWithCondition';
import { turtleFetch } from '../../utils/turtleFetch';

/**
 * The header and value that authenticate a worker to its www worker router. The token is not an
 * `Authorization` credential, and www accepts it only on that router.
 */
export type WorkerApiAuth = {
  authHeader: string;
  token: string;
};

export type WorkerApiRequestOptions = {
  /** Stops the request when aborted. */
  signal?: AbortSignal;
  /** node-fetch timeout of each attempt, in milliseconds. */
  timeoutMs?: number;
  /** Additional attempts for transient failures. Defaults to none; critical callers opt in. */
  retries?: number;
  logger?: bunyan;
};

const ApiV2ErrorResponseSchema = z.object({
  errors: z.array(z.object({ code: z.string().optional(), message: z.string() })).min(1),
});

/**
 * A request to a worker API failed. The message names the route and the reason. It never includes
 * the worker token.
 */
export class WorkerApiError extends Error {
  constructor(
    message: string,
    /** The HTTP status of the response, or undefined when no response arrived. */
    readonly status: number | undefined,
    options?: ErrorOptions,
    readonly code?: string
  ) {
    super(message, options);
    this.name = 'WorkerApiError';
  }

  get isTransient(): boolean {
    return this.status === undefined || this.status >= 500;
  }
}

/**
 * Client for one www worker router. The token names the resource the worker serves, so no request
 * carries its ID.
 */
export class WorkerApi {
  constructor(
    /** The URL of the worker router. It ends with a slash, so routes resolve under it. */
    private readonly baseUrl: string,
    private readonly auth: WorkerApiAuth
  ) {}

  public async requestAsync<T>(
    method: 'GET' | 'POST',
    route: string,
    dataSchema: z.ZodType<T>,
    { retries = 0, ...options }: WorkerApiRequestOptions & { json?: Record<string, unknown> } = {}
  ): Promise<T> {
    const url = new URL(route, this.baseUrl);
    const routeDescription = `${method} ${url.pathname}`;
    const request = () => {
      options.signal?.throwIfAborted();
      return this.requestOnceAsync(method, url.toString(), routeDescription, dataSchema, options);
    };
    if (retries === 0) {
      return await request();
    }
    return await promiseRetryWithCondition(
      request,
      error =>
        !options.signal?.aborted &&
        error instanceof WorkerApiError &&
        (error.status === undefined || error.status === 429 || error.status >= 500),
      { retries, factor: 2, minTimeout: 1000 },
      ({ attemptNumber, maxAttemptsCount }) =>
        options.logger?.warn(
          `Retrying ${routeDescription} (attempt ${attemptNumber}/${maxAttemptsCount}).`
        )
    )();
  }

  private async requestOnceAsync<T>(
    method: 'GET' | 'POST',
    url: string,
    routeDescription: string,
    dataSchema: z.ZodType<T>,
    {
      signal,
      timeoutMs,
      logger,
      json,
    }: Omit<WorkerApiRequestOptions, 'retries'> & {
      json?: Record<string, unknown>;
    }
  ): Promise<T> {
    const responseResult = await asyncResult(
      turtleFetch(url, method, {
        headers: { [this.auth.authHeader]: this.auth.token },
        ...(json ? { json } : {}),
        ...(signal ? { signal } : {}),
        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
        retries: 0,
        shouldThrowOnNotOk: false,
        logger,
      })
    );
    if (!responseResult.ok) {
      const reason = responseResult.reason;
      throw new WorkerApiError(
        `${routeDescription} failed before www responded: ${
          reason instanceof Error ? reason.message : String(reason)
        }. Check the network connection of the worker.`,
        undefined,
        { cause: reason }
      );
    }
    const response = responseResult.value;

    const bodyResult = await asyncResult(response.json());
    if (!response.ok) {
      const apiError = bodyResult.ok ? ApiV2ErrorResponseSchema.safeParse(bodyResult.value) : null;
      const apiErrorMessage = apiError?.success
        ? apiError.data.errors.map(error => error.message).join(' ')
        : response.statusText;
      throw new WorkerApiError(
        `${routeDescription} failed with status ${response.status}: ${apiErrorMessage}`,
        response.status,
        undefined,
        apiError?.success ? apiError.data.errors[0]?.code : undefined
      );
    }
    if (!bodyResult.ok) {
      if (
        bodyResult.reason instanceof FetchError &&
        ['system', 'body-timeout'].includes(bodyResult.reason.type)
      ) {
        throw new WorkerApiError(
          `${routeDescription} failed while reading the response body.`,
          undefined
        );
      }
      throw new WorkerApiError(
        `${routeDescription} returned a response that is not JSON.`,
        response.status
      );
    }
    const parsed = z.object({ data: dataSchema }).safeParse(bodyResult.value);
    if (!parsed.success) {
      throw new WorkerApiError(
        `${routeDescription} returned an unexpected response: ${parsed.error.message}`,
        response.status
      );
    }
    return parsed.data.data;
  }
}

/**
 * Returns the API v2 base URL of the worker. It throws when the worker knows no API server URL,
 * because a worker API client cannot work without it.
 */
export function getExpoApiV2BaseUrl(ctx: { env: Env; expoApiV2BaseUrl?: string }): string {
  if (ctx.expoApiV2BaseUrl) {
    return ctx.expoApiV2BaseUrl;
  }
  if (ctx.env.__API_SERVER_URL) {
    return new URL('/v2/', ctx.env.__API_SERVER_URL).toString();
  }
  throw new SystemError(
    'The API server URL is not set, so the worker cannot call its worker API. ' +
      'Check that the worker sets __API_SERVER_URL.'
  );
}
