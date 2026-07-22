import { z } from 'zod';

import fetch, { RequestError } from '../fetch';

const DeviceRunSessionEventSchema = z
  .object({
    v: z.literal(1),
    eventId: z.string(),
    ts: z.string(),
    producer: z.string(),
    type: z.string(),
    operationId: z.string().optional(),
    outcome: z.enum(['success', 'failure']).optional(),
    durationMs: z.number().optional(),
    summary: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type DeviceRunSessionEvent = z.infer<typeof DeviceRunSessionEventSchema>;

export async function downloadDeviceRunSessionEventsAsync(
  eventLogUrl: string
): Promise<DeviceRunSessionEvent[]> {
  try {
    const response = await fetch(eventLogUrl);
    return parseDeviceRunSessionEvents(await response.text());
  } catch (error) {
    if (error instanceof RequestError && error.response.status === 404) {
      return [];
    }
    throw error;
  }
}

export function parseDeviceRunSessionEvents(eventLog: string): DeviceRunSessionEvent[] {
  const events = new Map<string, DeviceRunSessionEvent>();

  for (const line of eventLog.split('\n')) {
    try {
      const result = DeviceRunSessionEventSchema.safeParse(JSON.parse(line));
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
