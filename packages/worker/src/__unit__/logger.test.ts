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

function captureStdout(): { output: string[]; write: jest.SpyInstance } {
  const output: string[] = [];
  // Never call the write callback, like a stdout that has not flushed yet.
  const write = jest.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    output.push(String(chunk));
    return true;
  });
  return { output, write };
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

  it('masks stdout and stderr messages before writing process output and the log buffer', async () => {
    const { logger, logBuffer } = await createBuildLoggerWithSecretsFilter({
      environmentSecrets: [
        { name: 'TOKEN', value: 'fake-provider-token', type: EnvironmentSecretType.STRING },
      ],
    });
    const { output, write } = captureStdout();
    try {
      logger.child({ source: 'stdout' }).info('stdout: fake-provider-token');
      logger.child({ source: 'stderr' }).error('stderr: fake-provider-token');
      await waitForStreamFlush();

      expect(output.map(line => JSON.parse(line).msg)).toEqual([
        'stdout: *******************',
        'stderr: *******************',
      ]);
      expect(logBuffer.getLogs()).toEqual([
        'stdout: *******************',
        'stderr: *******************',
      ]);
    } finally {
      write.mockRestore();
    }
  });

  it('masks secrets in every field except logger metadata', async () => {
    const { logger, outputStream } = await createBuildLoggerWithSecretsFilter({
      environmentSecrets: [
        { name: 'TOKEN', value: 'fake-provider-token', type: EnvironmentSecretType.STRING },
        { name: 'SOURCE', value: 'stdout', type: EnvironmentSecretType.STRING },
      ],
    });
    const logs: any[] = [];
    outputStream.on('data', log => logs.push(log));

    const err = new Error('request with fake-provider-token failed');
    logger
      .child({ source: 'stdout', buildStepDisplayName: 'Use fake-provider-token' })
      .error({ err, request: { headers: ['Bearer fake-provider-token'] } }, 'failed');
    await waitForStreamFlush();

    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0])).not.toContain('fake-provider-token');
    expect(logs[0].err.message).toBe('request with ******************* failed');
    expect(logs[0].err.stack).toContain('request with ******************* failed');
    expect(logs[0].request.headers).toEqual(['Bearer *******************']);
    expect(logs[0].buildStepDisplayName).toBe('Use *******************');
    expect(logs[0].source).toBe('stdout');
    expect(typeof logs[0].time).toBe('string');
  });

  it('writes records JSON.stringify would reject instead of throwing', async () => {
    const { logger, logBuffer } = await createBuildLoggerWithSecretsFilter({
      environmentSecrets: [
        { name: 'TOKEN', value: 'fake-provider-token', type: EnvironmentSecretType.STRING },
      ],
    });
    const { output, write } = captureStdout();
    try {
      const circular: Record<string, unknown> = { token: 'fake-provider-token' };
      circular.self = circular;
      const throwing = {
        toJSON() {
          throw new Error('nope');
        },
      };

      expect(() => {
        logger.child({ source: 'stdout' }).info({ circular, count: 1n }, 'circular');
        logger.child({ source: 'stdout' }).info({ throwing }, 'throwing fake-provider-token');
      }).not.toThrow();
      await waitForStreamFlush();

      const records = output.map(line => JSON.parse(line));
      expect(records).toHaveLength(2);
      expect(records[0].circular).toEqual({ token: '*******************', self: '[Circular]' });
      expect(records[0].count).toBe('1');
      expect(records[1].msg).toBe('throwing *******************');
      expect(records[1].throwing).toBeUndefined();
      expect(logBuffer.getLogs()).toEqual(['circular', 'throwing *******************']);
    } finally {
      write.mockRestore();
    }
  });

  it('does not hold other destinations back while stdout flushes', async () => {
    const { logger, logBuffer } = await createBuildLoggerWithSecretsFilter({});
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await waitForStreamFlush();
      const stdoutLogger = logger.child({ source: 'stdout' });
      for (let i = 0; i < 100; i++) {
        stdoutLogger.info(`line ${i}`);
      }

      expect(logBuffer.getLogs()).toHaveLength(100);
    } finally {
      write.mockRestore();
    }
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
