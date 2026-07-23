import { type bunyan } from '@expo/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../../customBuildContext';
import RemoteLoggerStream from '../../../logging/RemoteLoggerStream';
import { Sentry } from '../../../sentry';
import { startArgentEventCollectionAsync } from '../argentEvents';

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

const EVENT_LOG_FILENAME = 'tool-server-events.jsonl';

describe(startArgentEventCollectionAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps tool lifecycle records onto the shared operation vocabulary', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'argent-events-'));
    const eventLogFile = path.join(stateDir, EVENT_LOG_FILENAME);
    await fs.promises.writeFile(
      eventLogFile,
      `${JSON.stringify(
        bunyanRecord({
          level: 30,
          type: 'tool.invoked',
          toolId: 'screenshot',
          toolInvocationId: 'call-1',
          msg: 'Capturing screenshot.',
          time: '2026-07-10T12:00:00.000Z',
        })
      )}\n`
    );
    const ctx = createContext();
    const logger = createLogger();
    const collection = await startArgentEventCollectionAsync({
      ctx,
      deviceRunSessionId: 'session-id',
      stateDir,
      logger,
      pollIntervalMs: 10,
    });

    try {
      await waitForAsync(() => expect(mockEventLogStream.write).toHaveBeenCalledTimes(1));
      await fs.promises.appendFile(
        eventLogFile,
        `${JSON.stringify(
          bunyanRecord({
            level: 30,
            type: 'tool.completed',
            toolId: 'screenshot',
            toolInvocationId: 'call-1',
            durationMs: 12.34,
            msg: 'Captured screenshot.',
            time: '2026-07-10T12:00:01.000Z',
          })
        )}\n`
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
          headers: { 'content-disposition': 'attachment; filename="events.ndjson"' },
        },
      },
      options: { uploadIntervalMs: 5_000 },
    });
    expect(mockEventLogStream.init).toHaveBeenCalledTimes(1);
    expect(mockEventLogStream.cleanUp).toHaveBeenCalledTimes(1);
    expect(mockEventLogStream.write).toHaveBeenNthCalledWith(1, {
      v: 1,
      eventId: 'argent:session-id:tool-server-events:1',
      ts: '2026-07-10T12:00:00.000Z',
      producer: 'argent',
      type: 'operation.started',
      operationId: 'call-1',
      summary: 'Capturing screenshot.',
      data: { toolId: 'screenshot', sourceType: 'tool.invoked', sourceLevel: 30 },
    });
    expect(mockEventLogStream.write).toHaveBeenNthCalledWith(2, {
      v: 1,
      eventId: 'argent:session-id:tool-server-events:2',
      ts: '2026-07-10T12:00:01.000Z',
      producer: 'argent',
      type: 'operation.completed',
      operationId: 'call-1',
      outcome: 'success',
      durationMs: 12.34,
      summary: 'Captured screenshot.',
      data: { toolId: 'screenshot', sourceType: 'tool.completed', sourceLevel: 30 },
    });
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it('marks failed tool records as failed operations and keeps their failure signal', async () => {
    const failureSignal = {
      error_code: 'REGISTRY_TOOL_FAILURE_UNCLASSIFIED',
      failure_stage: 'registry_tool_failed_event',
      failure_area: 'registry',
      error_kind: 'unknown',
    };
    const event = await collectSingleEventAsync(
      bunyanRecord({
        level: 50,
        type: 'tool.failed',
        toolId: 'screenshot',
        toolInvocationId: 'call-2',
        failureSignal,
        msg: 'Failed to capture screenshot.',
        time: '2026-07-10T12:00:02.000Z',
      })
    );

    expect(event).toEqual({
      v: 1,
      eventId: 'argent:session-id:tool-server-events:1',
      ts: '2026-07-10T12:00:02.000Z',
      producer: 'argent',
      type: 'operation.completed',
      operationId: 'call-2',
      outcome: 'failure',
      summary: 'Failed to capture screenshot.',
      data: {
        toolId: 'screenshot',
        failureSignal,
        sourceType: 'tool.failed',
        sourceLevel: 50,
      },
    });
  });

  it('passes through non-tool lifecycle records unchanged', async () => {
    const event = await collectSingleEventAsync(
      bunyanRecord({
        level: 30,
        type: 'service.state_change',
        serviceId: 'ax-service',
        from: 'stopped',
        to: 'running',
        msg: 'Service ax-service changed state from stopped to running.',
        time: '2026-07-10T12:00:03.000Z',
      })
    );

    expect(event).toEqual({
      v: 1,
      eventId: 'argent:session-id:tool-server-events:1',
      ts: '2026-07-10T12:00:03.000Z',
      producer: 'argent',
      type: 'service.state_change',
      summary: 'Service ax-service changed state from stopped to running.',
      data: {
        serviceId: 'ax-service',
        from: 'stopped',
        to: 'running',
        sourceType: 'service.state_change',
        sourceLevel: 30,
      },
    });
  });

  it('falls back to a generated summary when the record has no message', async () => {
    const event = await collectSingleEventAsync(
      bunyanRecord({
        level: 30,
        type: 'tool.invoked',
        toolId: 'tap',
        toolInvocationId: 'call-3',
        msg: '',
        time: '2026-07-10T12:00:04.000Z',
      })
    );

    expect(event).toMatchObject({
      type: 'operation.started',
      summary: 'Invoked tap',
    });
  });

  it('reports an invalid record without emitting an event', async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'argent-events-'));
    await fs.promises.writeFile(
      path.join(stateDir, EVENT_LOG_FILENAME),
      // Missing the required `type` field.
      `${JSON.stringify({ time: '2026-07-10T12:00:00.000Z', msg: 'No type.' })}\n`
    );
    const collection = await startArgentEventCollectionAsync({
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

    expect(mockEventLogStream.write).not.toHaveBeenCalled();
    expect(Sentry.capture).toHaveBeenCalledWith('Could not parse an argent event log record', {
      level: 'warning',
      tags: { phase: 'argent-event-collection', reason: 'invalid-event' },
      extras: { deviceRunSessionId: 'session-id', lineNumber: 1 },
    });
  });
});

async function collectSingleEventAsync(
  record: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'argent-events-'));
  await fs.promises.writeFile(
    path.join(stateDir, EVENT_LOG_FILENAME),
    `${JSON.stringify(record)}\n`
  );
  const collection = await startArgentEventCollectionAsync({
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

  return mockEventLogStream.write.mock.calls[0][0];
}

function bunyanRecord(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'argent-tool-server',
    hostname: 'test-host',
    pid: 4242,
    v: 0,
    ...fields,
  };
}

function createContext(): CustomBuildContext {
  const mutation = jest.fn().mockReturnValue({
    toPromise: async () => ({
      data: {
        deviceRunSession: {
          createEventLogUploadSession: {
            uploadSession: {
              url: 'https://uploads.expo.test/events',
              headers: { 'content-disposition': 'attachment; filename="events.ndjson"' },
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
