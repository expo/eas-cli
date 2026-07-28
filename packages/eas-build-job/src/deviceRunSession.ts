import { z } from 'zod';

/**
 * Canonical record format for the activity events emitted during a remote device run (simulator)
 * session. Producers (e.g. the worker and agent-device) write these as NDJSON to the
 * session-events artifact and consumers (e.g. EAS CLI and the website) read them back. Keep this
 * schema in sync across every producer and consumer.
 */
export const DeviceRunSessionEventZ = z
  .object({
    v: z.literal(1),
    eventId: z.string(),
    ts: z.string().refine(ts => !Number.isNaN(new Date(ts).getTime())),
    producer: z.string(),
    type: z.string(),
    operationId: z.string().optional(),
    outcome: z.enum(['success', 'failure']).optional(),
    durationMs: z.number().optional(),
    summary: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type DeviceRunSessionEvent = z.infer<typeof DeviceRunSessionEventZ>;

/**
 * Parse the NDJSON session-events log into canonical event records, de-duplicating by `eventId`
 * and sorting chronologically by `ts`. Malformed or incomplete lines (including records with
 * invalid timestamps) are ignored so that a partially-flushed log is still readable.
 */
export function parseDeviceRunSessionEvents(eventLog: string): DeviceRunSessionEvent[] {
  const events = new Map<string, DeviceRunSessionEvent>();

  for (const line of eventLog.split('\n')) {
    try {
      const result = DeviceRunSessionEventZ.safeParse(JSON.parse(line));
      if (result.success) {
        events.set(result.data.eventId, result.data);
      }
    } catch {
      // Ignore malformed or incomplete records.
    }
  }

  return [...events.values()].sort(
    (left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime()
  );
}
