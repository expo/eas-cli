import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { graphql } from 'gql.tada';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import RemoteLoggerStream from '../../logging/RemoteLoggerStream';
import { Sentry } from '../../sentry';

const POLL_INTERVAL_MS = 1_000;
const UPLOAD_INTERVAL_MS = 5_000;

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

const CREATE_DEVICE_RUN_SESSION_EVENT_LOG_UPLOAD_SESSION_MUTATION = graphql(`
  mutation CreateDeviceRunSessionEventLogUploadSession($deviceRunSessionId: ID!) {
    deviceRunSession {
      createEventLogUploadSession(deviceRunSessionId: $deviceRunSessionId) {
        uploadSession {
          url
          headers
        }
      }
    }
  }
`);

type AgentDeviceEvent = z.infer<typeof AgentDeviceEventSchema>;

export type DeviceRunSessionEvent = {
  schemaVersion: 1;
  eventId: string;
  deviceRunSessionId: string;
  occurredAt: string;
  producer: string;
  producerVersion?: string;
  type: string;
  operationId?: string;
  name?: string;
  outcome?: 'success' | 'failure';
  durationMs?: number;
  summary: string;
  data?: Record<string, unknown>;
};

type EventFileState = {
  offset: number;
  nextSequenceNumber: number;
  nextLineNumber: number;
  pending: string;
  decoder: StringDecoder;
};

type AgentDeviceEventParseFailure = 'invalid-json' | 'invalid-event';
type AgentDeviceEventParseResult = {
  event?: AgentDeviceEvent;
  failure?: AgentDeviceEventParseFailure;
};

export async function startAgentDeviceEventCollectionAsync({
  ctx,
  deviceRunSessionId,
  stateDir,
  producerVersion,
  logger,
  pollIntervalMs = POLL_INTERVAL_MS,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  stateDir: string;
  producerVersion?: string;
  logger: bunyan;
  pollIntervalMs?: number;
}): Promise<{ stopAsync: () => Promise<void> }> {
  let didReportEventLogFailure = false;
  const reportEventLogFailure = (error: Error, operation: 'setup' | 'cleanup'): void => {
    if (didReportEventLogFailure) {
      return;
    }
    didReportEventLogFailure = true;
    Sentry.capture('Could not persist device run session events', error, {
      level: 'warning',
      tags: { phase: 'device-run-session-event-collection', operation },
      extras: { deviceRunSessionId },
    });
  };

  let eventLogStream: RemoteLoggerStream;
  try {
    const uploadSession = await createEventLogUploadSessionAsync(ctx, deviceRunSessionId);
    eventLogStream = new RemoteLoggerStream({
      logger,
      uploadMethod: { signedUrl: uploadSession },
      options: {
        uploadIntervalMs: UPLOAD_INTERVAL_MS,
      },
    });
    await eventLogStream.init();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn({ err: error }, 'Could not start device run session event collection.');
    reportEventLogFailure(error, 'setup');
    return { stopAsync: async () => {} };
  }

  const states = new Map<string, EventFileState>();
  const controller = new AbortController();
  let parseFailureCount = 0;
  const parseFailureCounts: Record<AgentDeviceEventParseFailure, number> = {
    'invalid-json': 0,
    'invalid-event': 0,
  };
  let didReportCollectionFailure = false;
  const collectAsync = async (): Promise<void> => {
    const eventFiles = await findAgentDeviceEventFilesAsync(stateDir);
    await Promise.all(
      eventFiles.map(async eventFile => {
        const state = states.get(eventFile) ?? {
          offset: 0,
          nextSequenceNumber: 1,
          nextLineNumber: 1,
          pending: '',
          decoder: new StringDecoder('utf8'),
        };
        states.set(eventFile, state);
        await collectEventFileAsync({
          eventFile,
          state,
          deviceRunSessionId,
          producerVersion,
          writeEvent: event => eventLogStream.write(event),
          onParseFailure: ({ failure, lineNumber }) => {
            parseFailureCount += 1;
            parseFailureCounts[failure] += 1;
            if (parseFailureCount !== 1) {
              return;
            }
            logger.warn(
              { agentDeviceEventParseFailure: failure, lineNumber },
              'Could not parse an agent-device event log record.'
            );
            Sentry.capture('Could not parse an agent-device event log record', {
              level: 'warning',
              tags: { phase: 'agent-device-event-collection', reason: failure },
              extras: { deviceRunSessionId, lineNumber },
            });
          },
        });
      })
    );
  };
  const collectSafelyAsync = async (): Promise<void> => {
    try {
      await collectAsync();
      didReportCollectionFailure = false;
    } catch (err) {
      if (didReportCollectionFailure) {
        return;
      }
      didReportCollectionFailure = true;
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn({ err: error }, 'Could not collect agent-device events.');
      Sentry.capture('Could not collect agent-device events', error, {
        level: 'warning',
        tags: { phase: 'agent-device-event-collection' },
        extras: { deviceRunSessionId },
      });
    }
  };

  const pollingPromise = (async () => {
    while (!controller.signal.aborted) {
      await collectSafelyAsync();

      try {
        await setTimeoutAsync(pollIntervalMs, undefined, { signal: controller.signal });
      } catch (err) {
        if (!controller.signal.aborted) {
          throw err;
        }
      }
    }
  })();

  return {
    stopAsync: async () => {
      controller.abort();
      await pollingPromise;
      await collectSafelyAsync();
      if (parseFailureCount > 1) {
        logger.warn(
          { agentDeviceEventParseFailures: parseFailureCounts, parseFailureCount },
          `Could not parse ${parseFailureCount} agent-device event log records.`
        );
        Sentry.capture('Could not parse multiple agent-device event log records', {
          level: 'warning',
          tags: { phase: 'agent-device-event-collection' },
          extras: { deviceRunSessionId, parseFailureCount, parseFailureCounts },
        });
      }
      try {
        await eventLogStream.cleanUp();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn({ err: error }, 'Could not finish device run session event collection.');
        reportEventLogFailure(error, 'cleanup');
      }
    },
  };
}

async function createEventLogUploadSessionAsync(
  ctx: CustomBuildContext,
  deviceRunSessionId: string
): Promise<{ url: string; headers: Record<string, string> }> {
  const result = await ctx.graphqlClient
    .mutation(CREATE_DEVICE_RUN_SESSION_EVENT_LOG_UPLOAD_SESSION_MUTATION, {
      deviceRunSessionId,
    })
    .toPromise();
  if (result.error) {
    throw new SystemError(
      `Failed to create device run session event log upload session: ${result.error.message}`,
      { cause: result.error }
    );
  }
  const uploadSession = result.data!.deviceRunSession.createEventLogUploadSession.uploadSession;
  return {
    url: uploadSession.url,
    headers: uploadSession.headers as Record<string, string>,
  };
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

async function collectEventFileAsync({
  eventFile,
  state,
  deviceRunSessionId,
  producerVersion,
  writeEvent,
  onParseFailure,
}: {
  eventFile: string;
  state: EventFileState;
  deviceRunSessionId: string;
  producerVersion?: string;
  writeEvent: (event: DeviceRunSessionEvent) => void;
  onParseFailure: (failure: { failure: AgentDeviceEventParseFailure; lineNumber: number }) => void;
}): Promise<void> {
  let fileSize: number;
  try {
    fileSize = (await fs.promises.stat(eventFile)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }

  if (fileSize < state.offset) {
    state.offset = 0;
    state.pending = '';
    state.decoder = new StringDecoder('utf8');
  }
  if (fileSize === state.offset) {
    return;
  }

  const handle = await fs.promises.open(eventFile, 'r');
  try {
    const buffer = new Uint8Array(new ArrayBuffer(fileSize - state.offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, state.offset);
    state.offset += bytesRead;
    const text = state.decoder.write(buffer.subarray(0, bytesRead));
    const lines = `${state.pending}${text}`.split('\n');
    state.pending = lines.pop() ?? '';

    for (const line of lines) {
      const lineNumber = state.nextLineNumber++;
      const sequenceNumber = state.nextSequenceNumber++;
      const { event, failure } = parseAgentDeviceEvent(line);
      if (failure) {
        onParseFailure({ failure, lineNumber });
      }
      if (!event) {
        continue;
      }
      const deviceRunSessionEvent = normalizeAgentDeviceEvent({
        event,
        sequenceNumber,
        sourceSessionDirectory: path.basename(path.dirname(eventFile)),
        deviceRunSessionId,
        producerVersion,
      });
      writeEvent(deviceRunSessionEvent);
    }
  } finally {
    await handle.close();
  }
}

function parseAgentDeviceEvent(line: string): AgentDeviceEventParseResult {
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
  producerVersion,
}: {
  event: AgentDeviceEvent;
  sequenceNumber: number;
  sourceSessionDirectory: string;
  deviceRunSessionId: string;
  producerVersion?: string;
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
    schemaVersion: 1,
    // Consumers use eventId to deduplicate events across polls. Keep the per-file sequence
    // monotonic across source-file truncations so an ID is never reused during collection.
    eventId: `agent-device:${deviceRunSessionId}:${sourceSessionDirectory}:${sequenceNumber}`,
    deviceRunSessionId,
    occurredAt: event.ts,
    producer: 'agent-device',
    ...(producerVersion ? { producerVersion } : {}),
    type,
    ...(event.requestId ? { operationId: event.requestId } : {}),
    ...(event.command ? { name: event.command } : {}),
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
