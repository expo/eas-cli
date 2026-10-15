import { Response } from 'node-fetch';
import { z } from 'zod';

export class GooglePlayApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string,
    readonly reasons: string[]
  ) {
    super(`Google Play request failed (HTTP ${status})${apiMessage ? `: ${apiMessage}` : '.'}`);
  }

  static isRetryableStatus(status: number): boolean {
    return status === 408 || status === 429 || (status >= 500 && status < 600);
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
      parsed.data?.error.errors?.flatMap(error => (error.reason ? [error.reason] : [])) ?? []
    );
  }
}
