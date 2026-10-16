import { Response } from 'node-fetch';
import { z } from 'zod';

const MAX_DETAILS = 5;
const MAX_DETAIL_LENGTH = 500;

// Reads only the human-readable parts of known google.rpc details. Other types and
// fields, such as ErrorInfo metadata, are skipped.
const DetailZ = z
  .union([
    z
      .object({
        '@type': z.literal('type.googleapis.com/google.rpc.ErrorInfo'),
        reason: z.string(),
      })
      .transform(detail => [detail.reason]),
    z
      .object({
        '@type': z.literal('type.googleapis.com/google.rpc.PreconditionFailure'),
        violations: z.array(z.object({ type: z.string().optional(), description: z.string() })),
      })
      .transform(detail =>
        detail.violations.map(({ type, description }) =>
          type ? `${type}: ${description}` : description
        )
      ),
    z
      .object({
        '@type': z.literal('type.googleapis.com/google.rpc.BadRequest'),
        fieldViolations: z.array(
          z.object({ field: z.string().optional(), description: z.string() })
        ),
      })
      .transform(detail =>
        detail.fieldViolations.map(({ field, description }) =>
          field ? `${field}: ${description}` : description
        )
      ),
  ])
  .catch([]);

export class GooglePlayApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string,
    readonly reasons: string[],
    readonly details: string[] = []
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
          // A malformed detail must not hide the primary message.
          details: z.array(DetailZ).catch([]),
        }),
      })
      .safeParse(data);
    return new GooglePlayApiError(
      response.status,
      parsed.data?.error.message ?? '',
      parsed.data?.error.errors?.flatMap(error => (error.reason ? [error.reason] : [])) ?? [],
      (parsed.data?.error.details ?? [])
        .flat()
        .slice(0, MAX_DETAILS)
        .map(detail => detail.slice(0, MAX_DETAIL_LENGTH))
    );
  }
}
