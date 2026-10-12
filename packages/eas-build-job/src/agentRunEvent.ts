import { z } from 'zod';

export const AgentRunEventContentZ = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    // The CLI message or item ID can be shared by several blocks or events.
    messageId: z.string().optional(),
    text: z.string(),
  }),
  z.object({
    type: z.literal('tool_call'),
    callId: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('tool_result'),
    callId: z.string(),
    text: z.string(),
    isError: z.boolean(),
  }),
  z.object({
    type: z.literal('error'),
    severity: z.enum(['warning', 'error']),
    message: z.string(),
  }),
]);

/**
 * Shared by the worker and event consumers. One record represents one CLI JSON event.
 * Use eventId to deduplicate records. Match CLI message and call IDs within invocationId.
 */
export const AgentRunEventZ = z.object({
  version: z.literal(1),
  eventId: z.string(),
  invocationId: z.string(),
  producer: z.enum(['claude-code', 'codex']),
  content: z.array(AgentRunEventContentZ),
});

export type AgentRunEventContent = z.infer<typeof AgentRunEventContentZ>;
export type AgentRunEvent = z.infer<typeof AgentRunEventZ>;
