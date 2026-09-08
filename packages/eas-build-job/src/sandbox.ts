import { z } from 'zod';

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
  z.strictObject({ jsonrpc: z.literal('2.0'), id: z.string(), result: z.unknown() }),
  z.strictObject({
    jsonrpc: z.literal('2.0'),
    id: z.string(),
    error: z.strictObject({ code: z.number().int(), message: z.string() }),
  }),
]);

export type SandboxDaemonResponse = z.output<typeof SandboxDaemonResponseZ>;
