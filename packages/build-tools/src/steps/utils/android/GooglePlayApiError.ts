import { ErrorMetadata } from '@expo/eas-build-job';
import { Response } from 'node-fetch';
import { z } from 'zod';

const MAX_RESPONSE_BODY_LENGTH = 8_000;

export class GooglePlayApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string,
    readonly reasons: string[],
    // Kept for Sentry only, so build logs stay short.
    readonly diagnostics: { requestPath?: string; responseBody?: string } = {}
  ) {
    super(`Google Play request failed (HTTP ${status})${apiMessage ? `: ${apiMessage}` : '.'}`);
  }

  static isRetryableStatus(status: number): boolean {
    return status === 408 || status === 429 || (status >= 500 && status < 600);
  }

  // Error metadata for the first Google Play API error in the cause chain. Retries and
  // uncertain commits wrap the API error, e.g. in an AggregateError.
  static getErrorMetadata(error: unknown): ErrorMetadata | undefined {
    let cause = error;
    for (let depth = 0; cause instanceof Error && depth < 5; depth++) {
      if (cause instanceof GooglePlayApiError) {
        return {
          googlePlayRequestPath: cause.diagnostics.requestPath,
          // A string, so Sentry does not cut off nested error details.
          googlePlayErrorResponse: cause.diagnostics.responseBody,
        };
      }
      cause = cause.cause;
    }
    return undefined;
  }

  static async fromResponseAsync(
    response: Response,
    signal?: AbortSignal
  ): Promise<GooglePlayApiError> {
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      signal?.throwIfAborted();
      // Raw text or HTML can contain the request URL, including an upload secret.
    }
    const parsed = z
      .object({
        error: z.object({
          message: z.string().optional(),
          errors: z.array(z.object({ reason: z.string().optional() })).optional(),
        }),
      })
      .safeParse(data);
    return new GooglePlayApiError(
      response.status,
      parsed.data?.error.message ?? '',
      parsed.data?.error.errors?.flatMap(error => (error.reason ? [error.reason] : [])) ?? [],
      {
        // Path only: the upload session query contains a secret.
        requestPath: response.url ? new URL(response.url).pathname : undefined,
        responseBody:
          data === undefined ? undefined : JSON.stringify(data).slice(0, MAX_RESPONSE_BODY_LENGTH),
      }
    );
  }
}
