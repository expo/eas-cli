import { z } from 'zod';

import fetch, { RequestError } from '../fetch';

const DeviceRunSessionEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string(),
    deviceRunSessionId: z.string(),
    occurredAt: z.string(),
    producer: z.string(),
    producerVersion: z.string().optional(),
    type: z.string(),
    operationId: z.string().optional(),
    name: z.string().optional(),
    outcome: z.enum(['success', 'failure']).optional(),
    durationMs: z.number().optional(),
    summary: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type DeviceRunSessionEvent = z.infer<typeof DeviceRunSessionEventSchema>;

export async function downloadDeviceRunSessionEventsAsync(
  eventLogUrl: string,
  deviceRunSessionId: string
): Promise<DeviceRunSessionEvent[]> {
  try {
    const response = await fetch(eventLogUrl);
    return parseDeviceRunSessionEvents(await response.text(), deviceRunSessionId);
  } catch (error) {
    if (error instanceof RequestError && error.response.status === 404) {
      return [];
    }
    throw error;
  }
}

export function parseDeviceRunSessionEvents(
  eventLog: string,
  deviceRunSessionId: string
): DeviceRunSessionEvent[] {
  const events = new Map<string, DeviceRunSessionEvent>();

  for (const line of eventLog.split('\n')) {
    try {
      const result = DeviceRunSessionEventSchema.safeParse(JSON.parse(line));
      if (result.success && result.data.deviceRunSessionId === deviceRunSessionId) {
        events.set(result.data.eventId, result.data);
      }
    } catch {
      // Ignore malformed or incomplete records.
    }
  }

  return [...events.values()].sort(
    (left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime()
  );
}
