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

const AGENT_DEVICE_PRODUCER = 'agent-device';

const AGENT_DEVICE_EVENT_KIND_TO_TYPE: Record<string, string> = {
  'request.started': 'operation.started',
  'request.finished': 'operation.completed',
  'action.recorded': 'interaction.recorded',
};

const AgentDeviceEventSchema = z
  .object({
    version: z.number(),
    ts: z.string(),
    session: z.string(),
    kind: z.string(),
    requestId: z.string().optional().catch(undefined),
    command: z.string().optional().catch(undefined),
    status: z.string().optional().catch(undefined),
    summary: z.string().optional().catch(undefined),
    details: z.record(z.string(), z.unknown()).optional().catch(undefined),
  })
  .passthrough();

type AgentDeviceEvent = z.infer<typeof AgentDeviceEventSchema>;

export async function startAgentDeviceEventCollectionAsync({
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
      producer: AGENT_DEVICE_PRODUCER,
      findEventFilesAsync: () => findAgentDeviceEventFilesAsync(stateDir),
      sourceKeyForFile: eventFile => path.basename(path.dirname(eventFile)),
      parseLine: ({ line, sourceKey, sequenceNumber, deviceRunSessionId }) => {
        const { event, failure } = parseAgentDeviceEvent(line);
        if (!event) {
          return { failure };
        }
        return {
          event: normalizeAgentDeviceEvent({
            event,
            sequenceNumber,
            sourceSessionDirectory: sourceKey,
            deviceRunSessionId,
          }),
        };
      },
    },
  });
}

async function findAgentDeviceEventFilesAsync(stateDir: string): Promise<string[]> {
  const sessionsDir = path.join(stateDir, 'sessions');
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(sessionsDir, entry.name, 'events.ndjson'));
}

type ParsedAgentDeviceEvent = {
  event?: AgentDeviceEvent;
  failure?: DeviceRunSessionEventParseFailure;
};

function parseAgentDeviceEvent(line: string): ParsedAgentDeviceEvent {
  if (!line.trim()) {
    return {};
  }
  try {
    const result = AgentDeviceEventSchema.safeParse(JSON.parse(line));
    return result.success ? { event: result.data } : { failure: 'invalid-event' };
  } catch {
    return { failure: 'invalid-json' };
  }
}

function normalizeAgentDeviceEvent({
  event,
  sequenceNumber,
  sourceSessionDirectory,
  deviceRunSessionId,
}: {
  event: AgentDeviceEvent;
  sequenceNumber: number;
  sourceSessionDirectory: string;
  deviceRunSessionId: string;
}): DeviceRunSessionEvent {
  const type = AGENT_DEVICE_EVENT_KIND_TO_TYPE[event.kind] ?? event.kind;
  const durationMs = event.details?.durationMs;
  const outcome =
    event.status === 'ok' ? 'success' : event.status === 'error' ? 'failure' : undefined;
  const summary =
    event.summary ??
    (event.kind === 'request.started'
      ? `Started ${event.command ?? 'activity'}`
      : event.kind === 'request.finished'
        ? `Finished ${event.command ?? 'activity'}`
        : event.kind === 'action.recorded'
          ? `Recorded ${event.command ?? 'activity'}`
          : `${event.kind}${event.command ? `: ${event.command}` : ''}`);

  return {
    v: 1,
    // Consumers use eventId to deduplicate events across polls. Keep the per-file sequence
    // monotonic across source-file truncations so an ID is never reused during collection.
    eventId: `agent-device:${deviceRunSessionId}:${sourceSessionDirectory}:${sequenceNumber}`,
    ts: event.ts,
    producer: 'agent-device',
    type,
    ...(event.requestId ? { operationId: event.requestId } : {}),
    ...(outcome ? { outcome } : {}),
    ...(typeof durationMs === 'number' ? { durationMs } : {}),
    summary,
    data: {
      ...event.details,
      session: event.session,
      sourceVersion: event.version,
      ...(event.status ? { sourceStatus: event.status } : {}),
    },
  };
}
