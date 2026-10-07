import { z } from 'zod';

const SandboxImageMimeTypeZ = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export const SandboxDaemonCommands = {
  execCommand: {
    params: z.object({
      cmd: z.string().min(1),
      workdir: z.string().optional(),
      tty: z.boolean().optional(),
      yieldTimeMs: z.number().int().min(0).max(30_000).optional(),
    }),
    result: z.union([
      z.strictObject({
        output: z.string(),
        wallTimeSeconds: z.number().nonnegative(),
        exitCode: z.number().int(),
      }),
      z.strictObject({
        output: z.string(),
        wallTimeSeconds: z.number().nonnegative(),
        terminationSignal: z.string().min(1),
      }),
      z.strictObject({
        output: z.string(),
        wallTimeSeconds: z.number().nonnegative(),
        sessionId: z.number().int().positive(),
      }),
    ]),
  },
  writeStdin: {
    params: z.object({
      sessionId: z.number().int().positive(),
      chars: z.string().optional(),
      yieldTimeMs: z.number().int().min(0).max(30_000).optional(),
    }),
    result: z.union([
      z.strictObject({
        output: z.string(),
        wallTimeSeconds: z.number().nonnegative(),
        exitCode: z.number().int(),
      }),
      z.strictObject({
        output: z.string(),
        wallTimeSeconds: z.number().nonnegative(),
        terminationSignal: z.string().min(1),
      }),
      z.strictObject({
        output: z.string(),
        wallTimeSeconds: z.number().nonnegative(),
        sessionId: z.number().int().positive(),
      }),
    ]),
  },
  readFile: {
    params: z.object({
      path: z.string().min(1),
      maxTextBytes: z.number().int().positive(),
      maxImageBytes: z.number().int().positive(),
    }),
    result: z.union([
      z.strictObject({
        kind: z.literal('image'),
        mimeType: SandboxImageMimeTypeZ,
        data: z.base64(),
      }),
      z.strictObject({
        kind: z.literal('image'),
        mimeType: SandboxImageMimeTypeZ,
        error: z.literal('tooLarge'),
        size: z.number().int().nonnegative(),
      }),
      z.strictObject({
        kind: z.literal('text'),
        text: z.string(),
        truncated: z.boolean(),
        size: z.number().int().nonnegative(),
      }),
      z.strictObject({
        kind: z.literal('binary'),
        size: z.number().int().nonnegative(),
      }),
    ]),
  },
  uploadArtifact: {
    params: z.object({
      path: z.string().min(1),
      name: z.string().min(1).max(1024),
    }),
    result: z.strictObject({ id: z.uuid() }),
  },
} as const satisfies Record<string, { params: z.ZodType; result: z.ZodType }>;

export type SandboxDaemonMethod = keyof typeof SandboxDaemonCommands;

export type SandboxDaemonCommandParams<Method extends SandboxDaemonMethod> = z.output<
  (typeof SandboxDaemonCommands)[Method]['params']
>;

export type SandboxDaemonCommandResult<Method extends SandboxDaemonMethod> = z.output<
  (typeof SandboxDaemonCommands)[Method]['result']
>;

export const SandboxDaemonRequestZ = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});

export type SandboxDaemonRequest = z.output<typeof SandboxDaemonRequestZ>;

export const SandboxDaemonResponseZ = z.union([
  z.strictObject({ jsonrpc: z.literal('2.0'), id: z.string(), result: z.unknown().nonoptional() }),
  z.strictObject({
    jsonrpc: z.literal('2.0'),
    id: z.string().nullable(),
    error: z.strictObject({
      code: z.number().int(),
      message: z.string(),
    }),
  }),
]);

export type SandboxDaemonResponse = z.output<typeof SandboxDaemonResponseZ>;

export enum SandboxDaemonErrorCode {
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  BAD_REQUEST = 1,
}

export type SandboxDaemonErrorCodeName = keyof typeof SandboxDaemonErrorCode;

export class SandboxDaemonError extends Error {
  constructor(
    public readonly code: (typeof SandboxDaemonErrorCode)[SandboxDaemonErrorCodeName],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SandboxDaemonError';
  }
}
