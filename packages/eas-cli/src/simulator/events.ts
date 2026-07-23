import { stripVTControlCharacters } from 'util';

import { z } from 'zod';

import fetch, { RequestError } from '../fetch';
import { formatMilliseconds } from '../utils/timer';

const DeviceRunSessionEventSchema = z
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

export function projectDeviceRunSessionEventsForDisplay(
  events: DeviceRunSessionEvent[],
  { includeIncompleteOperations = true }: { includeIncompleteOperations?: boolean } = {}
): DeviceRunSessionEvent[] {
  const operations = new Map<
    string,
    {
      completed?: DeviceRunSessionEvent;
      interactions: DeviceRunSessionEvent[];
    }
  >();

  for (const event of events) {
    if (!event.operationId) {
      continue;
    }
    const operationKey = getOperationKey(event);
    const operation = operations.get(operationKey) ?? { interactions: [] };
    if (event.type === 'operation.completed') {
      operation.completed = event;
    } else if (event.type === 'interaction.recorded') {
      operation.interactions.push(event);
    }
    operations.set(operationKey, operation);
  }

  return events.flatMap(event => {
    if (!event.operationId) {
      return [event];
    }

    const operation = operations.get(getOperationKey(event));
    const completed = operation?.completed;
    const interactions = operation?.interactions ?? [];

    if (
      !includeIncompleteOperations &&
      !completed &&
      (event.type === 'operation.started' || event.type === 'interaction.recorded')
    ) {
      return [];
    }
    if (event.type === 'operation.started' && (completed || interactions.length > 0)) {
      return [];
    }
    if (event.type === 'interaction.recorded' && completed?.outcome === 'failure') {
      return [];
    }
    if (event.type === 'operation.completed' && completed?.outcome !== 'failure') {
      return interactions.length > 0 ? [] : [event];
    }
    if (
      event.type === 'interaction.recorded' &&
      completed &&
      interactions.at(-1)?.eventId === event.eventId
    ) {
      return [{ ...event, durationMs: completed.durationMs, outcome: completed.outcome }];
    }

    return [event];
  });
}

export function formatDeviceRunSessionEvent(event: DeviceRunSessionEvent): string {
  const screenshotFilename = getScreenshotFilename(event);
  const summary =
    screenshotFilename && !event.summary.includes(screenshotFilename)
      ? `${event.summary} ${screenshotFilename}`
      : event.summary;
  const duration =
    event.durationMs === undefined ? '' : ` (${formatEventDuration(event.durationMs)})`;
  return stripTerminalControlCharacters(`${event.ts}  [${event.producer}] ${summary}${duration}`);
}

function getOperationKey(event: DeviceRunSessionEvent): string {
  return JSON.stringify([event.producer, event.operationId]);
}

function formatEventDuration(durationMs: number): string {
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : formatMilliseconds(durationMs);
}

function getScreenshotFilename(event: DeviceRunSessionEvent): string | undefined {
  if (event.data?.command !== 'screenshot' || typeof event.data.path !== 'string') {
    return undefined;
  }
  return event.data.path.split(/[\\/]/).at(-1);
}

function stripTerminalControlCharacters(value: string): string {
  return [...stripVTControlCharacters(value)]
    .filter(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && !(codePoint >= 0x7f && codePoint <= 0x9f);
    })
    .join('');
}
