import { type bunyan } from '@expo/logger';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import {
  type DeviceRunSessionEvent,
  type DeviceRunSessionEventParseFailure,
  startDeviceRunSessionEventCollectionAsync,
} from './deviceRunSessionEvents';

const ARGENT_PRODUCER = 'argent';
// Argent's tool-server writes its event log to `~/.argent/tool-server-events.jsonl`
// (its default $ARGENT_EVENT_LOG path) once the `tool-server-event-log` flag is on.
export const ARGENT_EVENT_LOG_FILENAME = 'tool-server-events.jsonl';

// Argent records are bunyan log lines tagged with a `type`. Map the tool-lifecycle
// types onto the shared operation vocabulary; anything else (service.*,
// tool_server.*, future types) passes through unchanged, mirroring agent-device.
const ARGENT_EVENT_TYPE_TO_TYPE: Record<string, string> = {
  'tool.invoked': 'operation.started',
  'tool.completed': 'operation.completed',
  'tool.failed': 'operation.completed',
};

// Bunyan bookkeeping plus the fields we promote to the top level of a
// DeviceRunSessionEvent — excluded from the free-form `data` bag so it carries
// only the record's own context (toolId, serviceId, failureSignal, ...).
const NON_DATA_KEYS = new Set([
  'name',
  'hostname',
  'pid',
  'v',
  'time',
  'msg',
  'level',
  'type',
  'toolInvocationId',
  'durationMs',
]);

const ArgentEventSchema = z
  .object({
    time: z.string(),
    type: z.string(),
    msg: z.string().optional().catch(undefined),
    level: z.number().optional().catch(undefined),
    toolId: z.string().optional().catch(undefined),
    toolInvocationId: z.string().optional().catch(undefined),
    durationMs: z.number().optional().catch(undefined),
  })
  .passthrough();

type ArgentEvent = z.infer<typeof ArgentEventSchema>;

type ParsedArgentEvent = {
  event?: ArgentEvent;
  failure?: DeviceRunSessionEventParseFailure;
};

export async function startArgentEventCollectionAsync({
  ctx,
  deviceRunSessionId,
  stateDir,
  logger,
  pollIntervalMs,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  stateDir: string;
  logger: bunyan;
  pollIntervalMs?: number;
}): Promise<{ stopAsync: () => Promise<void> }> {
  return startDeviceRunSessionEventCollectionAsync({
    ctx,
    deviceRunSessionId,
    logger,
    pollIntervalMs,
    source: {
      producer: ARGENT_PRODUCER,
      findEventFilesAsync: () => findArgentEventFilesAsync(stateDir),
      sourceKeyForFile: eventFile => path.basename(eventFile, path.extname(eventFile)),
      parseLine: ({ line, sourceKey, sequenceNumber, deviceRunSessionId }) => {
        const { event, failure } = parseArgentEvent(line);
        if (!event) {
          return { failure };
        }
        return {
          event: normalizeArgentEvent({ event, sequenceNumber, sourceKey, deviceRunSessionId }),
        };
      },
    },
  });
}

async function findArgentEventFilesAsync(stateDir: string): Promise<string[]> {
  const eventLogPath = path.join(stateDir, ARGENT_EVENT_LOG_FILENAME);
  try {
    await fs.promises.access(eventLogPath);
    return [eventLogPath];
  } catch {
    return [];
  }
}

function parseArgentEvent(line: string): ParsedArgentEvent {
  if (!line.trim()) {
    return {};
  }
  try {
    const result = ArgentEventSchema.safeParse(JSON.parse(line));
    return result.success ? { event: result.data } : { failure: 'invalid-event' };
  } catch {
    return { failure: 'invalid-json' };
  }
}

function normalizeArgentEvent({
  event,
  sequenceNumber,
  sourceKey,
  deviceRunSessionId,
}: {
  event: ArgentEvent;
  sequenceNumber: number;
  sourceKey: string;
  deviceRunSessionId: string;
}): DeviceRunSessionEvent {
  const type = ARGENT_EVENT_TYPE_TO_TYPE[event.type] ?? event.type;
  const outcome =
    event.type === 'tool.completed'
      ? 'success'
      : event.type === 'tool.failed'
        ? 'failure'
        : undefined;
  const summary =
    event.msg && event.msg.trim().length > 0 ? event.msg : summarizeArgentEvent(event);

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!NON_DATA_KEYS.has(key) && value !== undefined) {
      data[key] = value;
    }
  }
  data.sourceType = event.type;
  if (typeof event.level === 'number') {
    data.sourceLevel = event.level;
  }

  return {
    v: 1,
    // Consumers use eventId to deduplicate events across polls. Keep the per-file sequence
    // monotonic across source-file truncations so an ID is never reused during collection.
    eventId: `argent:${deviceRunSessionId}:${sourceKey}:${sequenceNumber}`,
    ts: event.time,
    producer: 'argent',
    type,
    ...(event.toolInvocationId ? { operationId: event.toolInvocationId } : {}),
    ...(outcome ? { outcome } : {}),
    ...(typeof event.durationMs === 'number' ? { durationMs: event.durationMs } : {}),
    summary,
    data,
  };
}

function summarizeArgentEvent(event: ArgentEvent): string {
  switch (event.type) {
    case 'tool.invoked':
      return `Invoked ${event.toolId ?? 'tool'}`;
    case 'tool.completed':
      return `Completed ${event.toolId ?? 'tool'}`;
    case 'tool.failed':
      return `Failed ${event.toolId ?? 'tool'}`;
    default:
      return event.type;
  }
}
