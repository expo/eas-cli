import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { graphql } from 'gql.tada';
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import RemoteLoggerStream from '../../logging/RemoteLoggerStream';
import { Sentry } from '../../sentry';
import { type SignedUrl } from '../../storage/uploadWithSignedUrl';

const POLL_INTERVAL_MS = 1_000;
const UPLOAD_INTERVAL_MS = 5_000;

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

/**
 * The normalized, producer-agnostic event shape uploaded to the API server.
 * Every remote-session producer (agent-device, argent, ...) tails its own
 * event log and maps its records onto this common contract so consumers render
 * a single unified session timeline.
 */
export type DeviceRunSessionEvent = {
  v: 1;
  eventId: string;
  ts: string;
  producer: string;
  type: string;
  operationId?: string;
  outcome?: 'success' | 'failure';
  durationMs?: number;
  summary: string;
  data?: Record<string, unknown>;
};

export type DeviceRunSessionEventParseFailure = 'invalid-json' | 'invalid-event';

export type DeviceRunSessionEventParseResult = {
  event?: DeviceRunSessionEvent;
  failure?: DeviceRunSessionEventParseFailure;
};

/**
 * Producer-specific adapter plugged into the generic collection engine. It only
 * has to say where its event files live and how to turn one raw NDJSON line
 * into a {@link DeviceRunSessionEvent}; the engine owns tailing, upload, polling
 * and failure reporting.
 */
export type DeviceRunSessionEventSource = {
  /** Stable producer identifier, e.g. `agent-device` or `argent`. */
  producer: string;
  /** Discover the NDJSON event files to tail (absolute paths). */
  findEventFilesAsync: () => Promise<string[]>;
  /** Namespace component of the event ID derived from a tailed file path. */
  sourceKeyForFile: (eventFile: string) => string;
  /**
   * Parse one raw NDJSON line. `sequenceNumber` is monotonic per file (kept
   * stable across truncations) and `sourceKey` namespaces the event ID so an ID
   * is never reused during collection. Blank lines should return an empty
   * result so they neither emit an event nor count as a parse failure.
   */
  parseLine: (args: {
    line: string;
    sourceKey: string;
    sequenceNumber: number;
    deviceRunSessionId: string;
  }) => DeviceRunSessionEventParseResult;
};

type EventFileState = {
  offset: number;
  nextSequenceNumber: number;
  nextLineNumber: number;
  pending: string;
  decoder: StringDecoder;
};

export async function startDeviceRunSessionEventCollectionAsync({
  ctx,
  deviceRunSessionId,
  source,
  logger,
  pollIntervalMs = POLL_INTERVAL_MS,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  source: DeviceRunSessionEventSource;
  logger: bunyan;
  pollIntervalMs?: number;
}): Promise<{ stopAsync: () => Promise<void> }> {
  const { producer } = source;
  let didReportEventLogFailure = false;
  const reportEventLogFailure = (error: Error, operation: 'setup' | 'cleanup'): void => {
    if (didReportEventLogFailure) {
      return;
    }
    didReportEventLogFailure = true;
    Sentry.capture('Could not persist device run session events', error, {
      level: 'warning',
      tags: { phase: 'device-run-session-event-collection', operation, producer },
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
  const parseFailureCounts: Record<DeviceRunSessionEventParseFailure, number> = {
    'invalid-json': 0,
    'invalid-event': 0,
  };
  let didReportCollectionFailure = false;
  const collectAsync = async (): Promise<void> => {
    const eventFiles = await source.findEventFilesAsync();
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
          source,
          deviceRunSessionId,
          writeEvent: event => eventLogStream.write(event),
          onParseFailure: ({ failure, lineNumber }) => {
            parseFailureCount += 1;
            parseFailureCounts[failure] += 1;
            if (parseFailureCount !== 1) {
              return;
            }
            logger.warn(
              { producer, eventParseFailure: failure, lineNumber },
              `Could not parse an ${producer} event log record.`
            );
            Sentry.capture(`Could not parse an ${producer} event log record`, {
              level: 'warning',
              tags: { phase: `${producer}-event-collection`, reason: failure },
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
      logger.warn({ err: error }, `Could not collect ${producer} events.`);
      Sentry.capture(`Could not collect ${producer} events`, error, {
        level: 'warning',
        tags: { phase: `${producer}-event-collection` },
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
  })()
    .catch(err => {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn({ err: error }, `${capitalize(producer)} event collection poller failed.`);
      Sentry.capture(`${capitalize(producer)} event collection poller failed`, error, {
        level: 'warning',
        tags: { phase: `${producer}-event-collection`, operation: 'poll' },
        extras: { deviceRunSessionId },
      });
    })
    .catch(() => {
      // A diagnostics failure must not recreate an unhandled rejection in this best-effort poller.
    });

  return {
    stopAsync: async () => {
      controller.abort();
      await pollingPromise;
      await collectSafelyAsync();
      if (parseFailureCount > 1) {
        logger.warn(
          { producer, eventParseFailures: parseFailureCounts, parseFailureCount },
          `Could not parse ${parseFailureCount} ${producer} event log records.`
        );
        Sentry.capture(`Could not parse multiple ${producer} event log records`, {
          level: 'warning',
          tags: { phase: `${producer}-event-collection` },
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
): Promise<SignedUrl> {
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

async function collectEventFileAsync({
  eventFile,
  state,
  source,
  deviceRunSessionId,
  writeEvent,
  onParseFailure,
}: {
  eventFile: string;
  state: EventFileState;
  source: DeviceRunSessionEventSource;
  deviceRunSessionId: string;
  writeEvent: (event: DeviceRunSessionEvent) => void;
  onParseFailure: (failure: {
    failure: DeviceRunSessionEventParseFailure;
    lineNumber: number;
  }) => void;
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

  const sourceKey = source.sourceKeyForFile(eventFile);
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
      const { event, failure } = source.parseLine({
        line,
        sourceKey,
        sequenceNumber,
        deviceRunSessionId,
      });
      if (failure) {
        onParseFailure({ failure, lineNumber });
      }
      if (!event) {
        continue;
      }
      writeEvent(event);
    }
  } finally {
    await handle.close();
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}
