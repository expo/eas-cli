import { Response } from 'node-fetch';
import { z } from 'zod';

// Keep only diagnostic fields. Metadata, subjects, unknown details and raw response
// bodies can contain request data or upload credentials.
const diagnosticText = z.string().transform(value =>
  value
    .replace(/https?:\/\/\S+/gi, '[URL redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[\r\n\x00-\x1f]/g, ' ')
    .slice(0, 300)
);
const legacyError = z.object({
  reason: diagnosticText.optional(),
  domain: diagnosticText.optional(),
  message: diagnosticText.optional(),
});
const detailSchema = z.discriminatedUnion('@type', [
  z.object({
    '@type': z.literal('type.googleapis.com/google.rpc.ErrorInfo'),
    reason: diagnosticText.optional(),
    domain: diagnosticText.optional(),
  }),
  z.object({
    '@type': z.literal('type.googleapis.com/google.rpc.PreconditionFailure'),
    violations: z
      .array(z.object({ type: diagnosticText.optional(), description: diagnosticText.optional() }))
      .transform(items => items.slice(0, 3)),
  }),
  z.object({
    '@type': z.literal('type.googleapis.com/google.rpc.BadRequest'),
    fieldViolations: z
      .array(z.object({ field: diagnosticText.optional(), description: diagnosticText.optional() }))
      .transform(items => items.slice(0, 3)),
  }),
]);

export class GooglePlayApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string,
    readonly reasons: string[],
    readonly diagnostics = ''
  ) {
    super(
      `Google Play request failed (HTTP ${status})${apiMessage ? `: ${apiMessage}` : '.'}${diagnostics ? `\n${diagnostics}` : ''}`
    );
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
          message: diagnosticText.optional(),
          status: diagnosticText.optional(),
          errors: z.array(z.unknown()).optional(),
          details: z.array(z.unknown()).optional(),
        }),
      })
      .safeParse(data);
    const errors = (parsed.data?.error.errors ?? []).flatMap(value => {
      const result = legacyError.safeParse(value);
      return result.success ? [result.data] : [];
    });
    const details = (parsed.data?.error.details ?? []).slice(0, 3).flatMap(value => {
      const result = detailSchema.safeParse(value);
      return result.success ? [result.data] : [];
    });
    const diagnostics = [
      parsed.data?.error.status,
      ...errors.slice(0, 3).map(value => JSON.stringify(value)),
      ...details.map(value => JSON.stringify(value)),
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
    return new GooglePlayApiError(
      response.status,
      parsed.data?.error.message ?? '',
      errors.flatMap(error => (error.reason ? [error.reason] : [])),
      diagnostics
    );
  }
}
