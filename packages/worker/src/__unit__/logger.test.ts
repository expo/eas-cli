import { TransformCallback, Writable } from 'node:stream';
import { EnvironmentSecretType } from '@expo/eas-build-job';
import z from 'zod';

jest.mock('@expo/build-tools', () => {
  const actual = jest.requireActual('@expo/build-tools');
  const { Writable } = jest.requireActual('node:stream');

  class MockRemoteLoggerStream extends Writable {
    public static readonly CompressionMethod = actual.RemoteLoggerStream.CompressionMethod;
    public static readonly instances: MockRemoteLoggerStream[] = [];

    public readonly writes: any[] = [];

    constructor(...args: any[]) {
      super({ objectMode: true });
      void args;
      MockRemoteLoggerStream.instances.push(this);
    }

    public async init(): Promise<string> {
      return 'https://gcs.expo.test/logs';
    }

    public async cleanUp(): Promise<void> {}

    public _write(
      chunk: unknown,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void
    ): void {
      this.writes.push(chunk);
      callback(null);
    }
  }

  class MockHttpLogStream extends Writable {
    public static readonly instances: MockHttpLogStream[] = [];

    public readonly writes: any[] = [];

    constructor(public readonly config: Record<string, unknown>) {
      super({ objectMode: true });
      MockHttpLogStream.instances.push(this);
    }

    public async cleanUp(): Promise<void> {}

    public _write(
      chunk: unknown,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void
    ): void {
      this.writes.push(chunk);
      callback(null);
    }
  }

  return {
    ...actual,
    uploadWithSignedUrl: jest.fn(),
    HttpLogStream: MockHttpLogStream,
    RemoteLoggerStream: MockRemoteLoggerStream,
  };
});

import config from '../config';
import { createBuildLoggerWithSecretsFilter } from '../logger';

async function waitForStreamFlush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

const { HttpLogStream, RemoteLoggerStream } = jest.requireMock('@expo/build-tools') as {
  HttpLogStream: {
    instances: Array<{
      config: Record<string, unknown>;
      writes: any[];
    }>;
  };
  RemoteLoggerStream: {
    instances: Array<{
      writes: any[];
    }>;
  };
};

describe('logger', () => {
  const originalHttpBaseUrl = config.loggers.http.baseUrl;
  const originalBuildId = config.buildId;
  const originalGcsSignedUploadUrlForLogs = config.loggers.gcs.signedUploadUrlForLogs;

  beforeEach(() => {
    HttpLogStream.instances.length = 0;
    RemoteLoggerStream.instances.length = 0;
  });

  afterEach(() => {
    config.loggers.http.baseUrl = originalHttpBaseUrl;
    config.buildId = originalBuildId;
    config.loggers.gcs.signedUploadUrlForLogs = originalGcsSignedUploadUrlForLogs;
  });

  it('obfuscates secrets in logs', async () => {
    const { logger, outputStream } = await createBuildLoggerWithSecretsFilter({
      environmentSecrets: [
        { name: 'TEST_SECRET', value: 'secret', type: EnvironmentSecretType.STRING },
        {
          name: 'ANOTHER_SECRET_BASE64',
          value: 'YW5vdGhlclNlY3JldA==',
          type: EnvironmentSecretType.STRING,
        },
      ],
    });

    const logs: any[] = [];

    const writable = new Writable({
      objectMode: true,
      write(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
        logs.push(chunk);
        callback(null, chunk);
      },
    });

    outputStream.pipe(writable);

    logger.info('this is a secret');
    logger.info(`another secret in base64 is ${Buffer.from('anotherSecret').toString('base64')}`);

    await waitForStreamFlush();

    expect(logs.length).toBe(2);
    expect(logs[0].msg).toBe('this is a ******');
    expect(logs[1].msg).toBe('another ****** in base64 is ********************');
  });

  it('masks structured agent content before both upload streams, including empty messages', async () => {
    config.loggers.http.baseUrl = 'https://logs.expo.test/logs/';
    config.buildId = 'build-id';
    config.loggers.gcs.signedUploadUrlForLogs = { url: 'https://gcs.expo.test/logs', headers: {} };
    const decoded = 'private"value\\with-slash';
    const encoded = Buffer.from(decoded).toString('base64');
    const { logger, cleanUp } = await createBuildLoggerWithSecretsFilter({
      robotAccessToken: 'robot-token',
      environmentSecrets: [
        { name: 'JOB_SECRET', value: 'job-secret', type: EnvironmentSecretType.STRING },
        { name: 'ENCODED_SECRET', value: encoded, type: EnvironmentSecretType.STRING },
      ],
    });
    const agentEvent = {
      version: 1,
      eventId: 'event-id',
      invocationId: 'invocation-id',
      producer: 'codex',
      content: [
        { type: 'message', text: `Message: ${decoded}` },
        {
          type: 'tool_call',
          callId: 'call-id',
          name: 'tool',
          arguments: {
            nested: [{ 'job-secret': [encoded, decoded, true, 12, null] }],
          },
        },
        { type: 'tool_result', callId: 'call-id', text: 'Result: job-secret', isError: false },
      ],
    };
    const original = JSON.stringify(agentEvent);
    logger.info({ agentEvent }, `Message: ${decoded}`);
    logger.info({ agentEvent }, '');
    await waitForStreamFlush();
    await cleanUp();

    expect(HttpLogStream.instances).toHaveLength(1);
    expect(RemoteLoggerStream.instances).toHaveLength(1);
    for (const stream of [HttpLogStream.instances[0], RemoteLoggerStream.instances[0]]) {
      expect(stream.writes).toHaveLength(2);
      expect(stream.writes.map(log => log.msg)).toEqual([
        `Message: ${'*'.repeat(decoded.length)}`,
        '',
      ]);
      for (const log of stream.writes) {
        expect(log.agentEvent).toEqual({
          version: 1,
          eventId: 'event-id',
          invocationId: 'invocation-id',
          producer: 'codex',
          content: [
            { type: 'message', text: `Message: ${'*'.repeat(decoded.length)}` },
            {
              type: 'tool_call',
              callId: 'call-id',
              name: 'tool',
              arguments: {
                nested: [
                  {
                    '**********': [
                      '*'.repeat(encoded.length),
                      '*'.repeat(decoded.length),
                      true,
                      12,
                      null,
                    ],
                  },
                ],
              },
            },
            { type: 'tool_result', callId: 'call-id', text: 'Result: **********', isError: false },
          ],
        });
        expect(JSON.stringify(log)).not.toContain('job-secret');
        expect(JSON.stringify(log)).not.toContain(encoded);
      }
    }
    expect(JSON.stringify(agentEvent)).toBe(original);
  });

  it('adds logId to each log', async () => {
    const { logger, outputStream } = await createBuildLoggerWithSecretsFilter({});

    const logs: any[] = [];

    const writable = new Writable({
      objectMode: true,
      write(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
        logs.push(chunk);
        callback(null, chunk);
      },
    });

    outputStream.pipe(writable);

    logger.info('Test log');
    logger.info('Test log');

    await waitForStreamFlush();

    expect(logs.length).toBe(2);

    for (const log of logs) {
      expect(log.logId).toBeDefined();
      expect(z.uuidv7().parse(log.logId)).toBe(log.logId);
    }

    expect(logs[0].logId).not.toBe(logs[1].logId);
  });

  it('preserves logId when forwarding logs over HTTP', async () => {
    config.loggers.http.baseUrl = 'https://logs.expo.test/logs/';
    config.buildId = 'build-id';

    const { logger, outputStream, cleanUp } = await createBuildLoggerWithSecretsFilter({
      robotAccessToken: 'robot-token',
    });

    const logs: any[] = [];
    const writable = new Writable({
      objectMode: true,
      write(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
        logs.push(chunk);
        callback(null, chunk);
      },
    });

    outputStream.pipe(writable);
    logger.info('Test log');

    await waitForStreamFlush();
    await cleanUp();

    expect(logs).toHaveLength(1);
    expect(HttpLogStream.instances).toHaveLength(1);
    expect(HttpLogStream.instances[0].config).toEqual({
      url: 'https://logs.expo.test/logs/build-id',
      headers: { Authorization: 'Bearer robot-token' },
      bufferRetentionMs: null,
      logger: expect.anything(),
    });
    expect(HttpLogStream.instances[0].writes).toHaveLength(1);
    expect(HttpLogStream.instances[0].writes[0].logId).toBe(logs[0].logId);
  });

  it('drains transformed logs even without explicit output consumer', async () => {
    const { logger, outputStream } = await createBuildLoggerWithSecretsFilter({});

    logger.info('Test log');
    logger.info('Test log');
    logger.info('Test log');

    await waitForStreamFlush();

    expect(outputStream.readableLength).toBe(0);
  });
});
