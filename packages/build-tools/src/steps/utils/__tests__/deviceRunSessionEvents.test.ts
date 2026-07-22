import { type bunyan } from '@expo/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../../customBuildContext';
import RemoteLoggerStream from '../../../logging/RemoteLoggerStream';
import { Sentry } from '../../../sentry';
import { startAgentDeviceEventCollectionAsync } from '../deviceRunSessionEvents';

const mockEventLogStream = {
  init: jest.fn(async () => undefined),
  write: jest.fn(),
  cleanUp: jest.fn(async () => undefined),
};

jest.mock('../../../logging/RemoteLoggerStream', () => ({
  __esModule: true,
  default: jest.fn(() => mockEventLogStream),
}));
jest.mock('../../../sentry');

describe(startAgentDeviceEventCollectionAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploads normalized events to the session event artifact once', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-events-'));
    const eventsDir = path.join(stateDir, 'sessions', 'default');
    const eventsFile = path.join(eventsDir, 'events.ndjson');
    await fs.promises.mkdir(eventsDir, { recursive: true });
    await fs.promises.writeFile(
      eventsFile,
      `${JSON.stringify({
        version: 1,
        ts: '2026-07-10T12:00:00.000Z',
        session: 'default',
        kind: 'request.started',
        requestId: 'request-1',
        command: 'tap',
        summary: 'Started tap',
      })}\n`
    );
    const ctx = createContext();
    const logger = createLogger();
    const collection = await startAgentDeviceEventCollectionAsync({
      ctx,
      deviceRunSessionId: 'session-id',
      stateDir,
      logger,
      pollIntervalMs: 10,
    });

    try {
      await waitForAsync(() => expect(mockEventLogStream.write).toHaveBeenCalledTimes(1));
      await fs.promises.appendFile(
        eventsFile,
        `${JSON.stringify({
          version: 1,
          ts: '2026-07-10T12:00:01.000Z',
          session: 'default',
          kind: 'request.finished',
          requestId: 'request-1',
          command: 'tap',
          status: 'ok',
          summary: 'Finished tap',
          details: { durationMs: 25 },
        })}\n${JSON.stringify({
          version: 1,
          ts: 123,
          session: 'default',
          kind: 'request.started',
        })}\n`
      );
      await waitForAsync(() => expect(mockEventLogStream.write).toHaveBeenCalledTimes(2));
    } finally {
      await collection.stopAsync();
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }

    expect(ctx.graphqlClient.mutation).toHaveBeenCalledWith(expect.anything(), {
      deviceRunSessionId: 'session-id',
    });
    expect(RemoteLoggerStream).toHaveBeenCalledWith({
      logger,
      uploadMethod: {
        signedUrl: {
          url: 'https://uploads.expo.test/events',
          headers: {
            'content-disposition': 'attachment; filename="events.ndjson"',
            'x-goog-content-length-range': '0,104857600',
          },
        },
      },
      options: { uploadIntervalMs: 5_000 },
    });
    expect(mockEventLogStream.init).toHaveBeenCalledTimes(1);
    expect(mockEventLogStream.cleanUp).toHaveBeenCalledTimes(1);
    expect(mockEventLogStream.write).toHaveBeenNthCalledWith(2, {
      v: 1,
      eventId: 'agent-device:session-id:default:2',
      ts: '2026-07-10T12:00:01.000Z',
      producer: 'agent-device',
      type: 'operation.completed',
      operationId: 'request-1',
      outcome: 'success',
      durationMs: 25,
      summary: 'Finished tap',
      data: {
        session: 'default',
        sourceVersion: 1,
        sourceStatus: 'ok',
        durationMs: 25,
      },
    });
    expect(Sentry.capture).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not parse an agent-device event log record',
      {
        level: 'warning',
        tags: { phase: 'agent-device-event-collection', reason: 'invalid-event' },
        extras: { deviceRunSessionId: 'session-id', lineNumber: 3 },
      }
    );
  });

  it('preserves unknown kinds and tolerates optional upstream field changes', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-events-'));
    const eventsDir = path.join(stateDir, 'sessions', 'default');
    await fs.promises.mkdir(eventsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(eventsDir, 'events.ndjson'),
      `${JSON.stringify({
        version: 2,
        ts: '2026-07-10T12:00:00.000Z',
        session: 'default',
        kind: 'snapshot.recorded',
        requestId: 123,
        status: 'queued',
        newUpstreamField: true,
      })}\n`
    );
    const collection = await startAgentDeviceEventCollectionAsync({
      ctx: createContext(),
      deviceRunSessionId: 'session-id',
      stateDir,
      logger: createLogger(),
      pollIntervalMs: 10,
    });

    try {
      await waitForAsync(() => expect(mockEventLogStream.write).toHaveBeenCalledTimes(1));
    } finally {
      await collection.stopAsync();
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }

    expect(mockEventLogStream.write).toHaveBeenCalledWith({
      v: 1,
      eventId: 'agent-device:session-id:default:1',
      ts: '2026-07-10T12:00:00.000Z',
      producer: 'agent-device',
      type: 'snapshot.recorded',
      summary: 'snapshot.recorded',
      data: { session: 'default', sourceVersion: 2, sourceStatus: 'queued' },
    });
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it('preserves a multi-byte character split across polls', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-events-'));
    const eventsDir = path.join(stateDir, 'sessions', 'unicode-session');
    const eventsFile = path.join(eventsDir, 'events.ndjson');
    await fs.promises.mkdir(eventsDir, { recursive: true });
    const completeEvent = `${JSON.stringify(
      createAgentDeviceEvent({ summary: 'Complete event before split character' })
    )}\n`;
    const splitEvent = `${JSON.stringify(
      createAgentDeviceEvent({ session: 'upstream-session', summary: 'Tapped 🙂 successfully' })
    )}\n`;
    const serializedText = `${completeEvent}${splitEvent}`;
    const emojiCharacterOffset = serializedText.indexOf('🙂');
    expect(emojiCharacterOffset).toBeGreaterThanOrEqual(0);
    const encoder = new TextEncoder();
    const serializedEvent = encoder.encode(serializedText);
    const splitOffset =
      encoder.encode(serializedText.slice(0, emojiCharacterOffset)).byteLength + 2;
    await fs.promises.writeFile(eventsFile, serializedEvent.subarray(0, splitOffset));

    const collection = await startAgentDeviceEventCollectionAsync({
      ctx: createContext(),
      deviceRunSessionId: 'session-id',
      stateDir,
      logger: createLogger(),
      pollIntervalMs: 60_000,
    });

    try {
      await waitForAsync(() => expect(mockEventLogStream.write).toHaveBeenCalledTimes(1));
      await fs.promises.appendFile(eventsFile, serializedEvent.subarray(splitOffset));
    } finally {
      await collection.stopAsync();
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }

    expect(mockEventLogStream.write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'agent-device:session-id:unicode-session:2',
        summary: 'Tapped 🙂 successfully',
      })
    );
  });

  it('reassembles a partial line across polls', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-events-'));
    const eventsDir = path.join(stateDir, 'sessions', 'partial-line-session');
    const eventsFile = path.join(eventsDir, 'events.ndjson');
    await fs.promises.mkdir(eventsDir, { recursive: true });
    const completeEvent = `${JSON.stringify(
      createAgentDeviceEvent({ summary: 'Complete event before partial line' })
    )}\n`;
    const partialEvent = `${JSON.stringify(
      createAgentDeviceEvent({ summary: 'Completed after two writes' })
    )}\n`;
    const serializedEvent = `${completeEvent}${partialEvent}`;
    const splitOffset = completeEvent.length + Math.floor(partialEvent.length / 2);
    await fs.promises.writeFile(eventsFile, serializedEvent.slice(0, splitOffset));

    const collection = await startAgentDeviceEventCollectionAsync({
      ctx: createContext(),
      deviceRunSessionId: 'session-id',
      stateDir,
      logger: createLogger(),
      pollIntervalMs: 60_000,
    });

    try {
      await waitForAsync(() => expect(mockEventLogStream.write).toHaveBeenCalledTimes(1));
      await fs.promises.appendFile(eventsFile, serializedEvent.slice(splitOffset));
    } finally {
      await collection.stopAsync();
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }

    expect(mockEventLogStream.write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'agent-device:session-id:partial-line-session:2',
        summary: 'Completed after two writes',
      })
    );
  });

  it('does not reuse event IDs after the source file is truncated', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-events-'));
    const eventsDir = path.join(stateDir, 'sessions', 'rotated-session');
    const eventsFile = path.join(eventsDir, 'events.ndjson');
    await fs.promises.mkdir(eventsDir, { recursive: true });
    await fs.promises.writeFile(
      eventsFile,
      `${JSON.stringify(createAgentDeviceEvent({ summary: 'First event before truncation' }))}\n${JSON.stringify(
        createAgentDeviceEvent({ summary: 'Second event before truncation' })
      )}\n`
    );

    const collection = await startAgentDeviceEventCollectionAsync({
      ctx: createContext(),
      deviceRunSessionId: 'session-id',
      stateDir,
      logger: createLogger(),
      pollIntervalMs: 60_000,
    });

    try {
      await waitForAsync(() => expect(mockEventLogStream.write).toHaveBeenCalledTimes(2));
      await fs.promises.writeFile(
        eventsFile,
        `${JSON.stringify(createAgentDeviceEvent({ summary: 'After truncation' }))}\n`
      );
    } finally {
      await collection.stopAsync();
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }

    expect(mockEventLogStream.write).toHaveBeenCalledTimes(3);
    expect(mockEventLogStream.write).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        eventId: 'agent-device:session-id:rotated-session:3',
        summary: 'After truncation',
      })
    );
  });

  it('namespaces events by their source session directory', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-events-'));
    const firstEventsDir = path.join(stateDir, 'sessions', 'first-directory');
    const secondEventsDir = path.join(stateDir, 'sessions', 'second-directory');
    await Promise.all([
      fs.promises.mkdir(firstEventsDir, { recursive: true }),
      fs.promises.mkdir(secondEventsDir, { recursive: true }),
    ]);
    await Promise.all([
      fs.promises.writeFile(
        path.join(firstEventsDir, 'events.ndjson'),
        `${JSON.stringify(
          createAgentDeviceEvent({ session: 'shared-upstream-session', summary: 'First directory' })
        )}\n`
      ),
      fs.promises.writeFile(
        path.join(secondEventsDir, 'events.ndjson'),
        `${JSON.stringify(
          createAgentDeviceEvent({
            session: 'shared-upstream-session',
            summary: 'Second directory',
          })
        )}\n`
      ),
    ]);

    const collection = await startAgentDeviceEventCollectionAsync({
      ctx: createContext(),
      deviceRunSessionId: 'session-id',
      stateDir,
      logger: createLogger(),
      pollIntervalMs: 60_000,
    });

    try {
      await waitForAsync(() => expect(mockEventLogStream.write).toHaveBeenCalledTimes(2));
    } finally {
      await collection.stopAsync();
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }

    expect(mockEventLogStream.write.mock.calls.map(([event]) => event.eventId).sort()).toEqual([
      'agent-device:session-id:first-directory:1',
      'agent-device:session-id:second-directory:1',
    ]);
  });

  it('reports an aggregate summary when multiple records cannot be parsed', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-events-'));
    const eventsDir = path.join(stateDir, 'sessions', 'default');
    await fs.promises.mkdir(eventsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(eventsDir, 'events.ndjson'),
      `not-json\n${JSON.stringify({
        version: 1,
        ts: 123,
        session: 'default',
        kind: 'request.started',
      })}\n`
    );
    const logger = createLogger();
    const collection = await startAgentDeviceEventCollectionAsync({
      ctx: createContext(),
      deviceRunSessionId: 'session-id',
      stateDir,
      logger,
      pollIntervalMs: 60_000,
    });

    try {
      await waitForAsync(() => expect(Sentry.capture).toHaveBeenCalledTimes(1));
    } finally {
      await collection.stopAsync();
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }

    expect(logger.warn).toHaveBeenCalledWith(
      {
        agentDeviceEventParseFailures: { 'invalid-json': 1, 'invalid-event': 1 },
        parseFailureCount: 2,
      },
      'Could not parse 2 agent-device event log records.'
    );
    expect(Sentry.capture).toHaveBeenCalledTimes(2);
    expect(Sentry.capture).toHaveBeenNthCalledWith(
      2,
      'Could not parse multiple agent-device event log records',
      {
        level: 'warning',
        tags: { phase: 'agent-device-event-collection' },
        extras: {
          deviceRunSessionId: 'session-id',
          parseFailureCount: 2,
          parseFailureCounts: { 'invalid-json': 1, 'invalid-event': 1 },
        },
      }
    );
  });

  it('reports a continuous collection failure only once', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-events-'));
    await fs.promises.writeFile(path.join(stateDir, 'sessions'), 'not a directory');
    const collection = await startAgentDeviceEventCollectionAsync({
      ctx: createContext(),
      deviceRunSessionId: 'session-id',
      stateDir,
      logger: createLogger(),
      pollIntervalMs: 10,
    });

    try {
      await waitForAsync(() => expect(Sentry.capture).toHaveBeenCalledTimes(1));
    } finally {
      await collection.stopAsync();
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }

    expect(Sentry.capture).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not collect agent-device events',
      expect.any(Error),
      {
        level: 'warning',
        tags: { phase: 'agent-device-event-collection' },
        extras: { deviceRunSessionId: 'session-id' },
      }
    );
  });

  it('handles a polling rejection even when reporting it fails', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-events-'));
    await fs.promises.writeFile(path.join(stateDir, 'sessions'), 'not a directory');
    const reportingError = new Error('Sentry unavailable');
    jest
      .mocked(Sentry.capture)
      .mockImplementationOnce(() => {
        throw reportingError;
      })
      .mockImplementationOnce(() => {
        throw reportingError;
      });
    const logger = createLogger();
    const collection = await startAgentDeviceEventCollectionAsync({
      ctx: createContext(),
      deviceRunSessionId: 'session-id',
      stateDir,
      logger,
      pollIntervalMs: 10,
    });

    try {
      await waitForAsync(() =>
        expect(logger.warn).toHaveBeenCalledWith(
          { err: reportingError },
          'Agent-device event collection poller failed.'
        )
      );
      await expect(collection.stopAsync()).resolves.toBeUndefined();
    } finally {
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }

    expect(Sentry.capture).toHaveBeenCalledTimes(2);
    expect(Sentry.capture).toHaveBeenNthCalledWith(
      2,
      'Agent-device event collection poller failed',
      reportingError,
      {
        level: 'warning',
        tags: { phase: 'agent-device-event-collection', operation: 'poll' },
        extras: { deviceRunSessionId: 'session-id' },
      }
    );
    expect(mockEventLogStream.cleanUp).toHaveBeenCalledTimes(1);
  });

  it('does not fail the session when event log setup fails', async () => {
    const error = new Error('WWW unavailable');
    const ctx = createContext();
    jest.mocked(ctx.graphqlClient.mutation).mockReturnValueOnce({
      toPromise: async () => ({ error }),
    } as unknown as ReturnType<CustomBuildContext['graphqlClient']['mutation']>);
    const logger = createLogger();

    const collection = await startAgentDeviceEventCollectionAsync({
      ctx,
      deviceRunSessionId: 'session-id',
      stateDir: '/does/not/matter',
      logger,
      pollIntervalMs: 10,
    });
    await collection.stopAsync();

    expect(logger.warn).toHaveBeenCalledWith(
      {
        err: expect.objectContaining({
          message: 'Failed to create device run session event log upload session: WWW unavailable',
          cause: error,
        }),
      },
      'Could not start device run session event collection.'
    );
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not persist device run session events',
      expect.objectContaining({
        message: 'Failed to create device run session event log upload session: WWW unavailable',
        cause: error,
      }),
      {
        level: 'warning',
        tags: { phase: 'device-run-session-event-collection', operation: 'setup' },
        extras: { deviceRunSessionId: 'session-id' },
      }
    );
    expect(mockEventLogStream.init).not.toHaveBeenCalled();
  });
});

function createContext(): CustomBuildContext {
  const mutation = jest.fn().mockReturnValue({
    toPromise: async () => ({
      data: {
        deviceRunSession: {
          createEventLogUploadSession: {
            uploadSession: {
              url: 'https://uploads.expo.test/events',
              headers: {
                'content-disposition': 'attachment; filename="events.ndjson"',
                'x-goog-content-length-range': '0,104857600',
              },
            },
          },
        },
      },
    }),
  });
  return { graphqlClient: { mutation } } as unknown as CustomBuildContext;
}

function createLogger(): bunyan {
  return { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
}

function createAgentDeviceEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    ts: '2026-07-10T12:00:00.000Z',
    session: 'default',
    kind: 'request.started',
    summary: 'Started activity',
    ...overrides,
  };
}

async function waitForAsync(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() >= deadline) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}
