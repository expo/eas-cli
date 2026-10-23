import { Readable, Transform, TransformCallback, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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

  it('obfuscates secrets added after the logger was created', async () => {
    const { logger, outputStream, logBuffer, addBuildLogMask } =
      await createBuildLoggerWithSecretsFilter({});

    const logs: any[] = [];
    outputStream.pipe(
      new Writable({
        objectMode: true,
        write(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
          logs.push(chunk);
          callback(null, chunk);
        },
      })
    );

    addBuildLogMask('leased-token');
    addBuildLogMask(Buffer.from('decodedToken').toString('base64'));
    addBuildLogMask('production');
    logger.child({ source: 'stdout' }).info('leased-token, decodedToken, production');

    await waitForStreamFlush();

    expect(logs.map(log => log.msg)).toEqual(['************, ************, production']);
    expect(logBuffer.getLogs()).toEqual(['************, ************, production']);
  });

  it('obfuscates a secret that contains another secret', async () => {
    const { logger, outputStream, addBuildLogMask } = await createBuildLoggerWithSecretsFilter({
      environmentSecrets: [{ name: 'PREFIX', value: 'sk-', type: EnvironmentSecretType.STRING }],
    });

    const logs: any[] = [];
    outputStream.pipe(
      new Writable({
        objectMode: true,
        write(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
          logs.push(chunk);
          callback(null, chunk);
        },
      })
    );

    addBuildLogMask('sk-leased-token');
    logger.info('token: sk-leased-token, prefix: sk-');

    await waitForStreamFlush();

    expect(logs.map(log => log.msg)).toEqual(['token: ***************, prefix: ***']);
  });

  describe('structured fields', () => {
    async function logWithSecretAsync(
      log: (
        logger: Awaited<ReturnType<typeof createBuildLoggerWithSecretsFilter>>['logger']
      ) => void
    ): Promise<any[]> {
      const { logger, outputStream } = await createBuildLoggerWithSecretsFilter({
        environmentSecrets: [
          { name: 'TOKEN', value: 'secret-token', type: EnvironmentSecretType.STRING },
          { name: 'PIN', value: '123456789', type: EnvironmentSecretType.STRING },
        ],
      });
      const logs: any[] = [];
      outputStream.pipe(
        new Writable({
          objectMode: true,
          write(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
            logs.push(chunk);
            callback(null, chunk);
          },
        })
      );
      log(logger);
      await waitForStreamFlush();
      // The upload streams send JSON.stringify(record).
      for (const record of logs) {
        expect(JSON.stringify(record)).not.toContain('secret-token');
        expect(JSON.stringify(record)).not.toContain('123456789');
      }
      return logs;
    }

    it('masks errors, including when the message is empty', async () => {
      const err = new Error('git clone https://secret-token@github.com/acme/app failed');
      const logs = await logWithSecretAsync(logger => {
        logger.error({ err }, '');
        logger.error({ err });
      });

      expect(logs).toHaveLength(2);
      for (const log of logs) {
        expect(log.err.message).toBe('git clone https://************@github.com/acme/app failed');
        expect(log.err.stack).toContain(
          'git clone https://************@github.com/acme/app failed'
        );
      }
      expect(logs[0].msg).toBe('');
      expect(logs[1].msg).toBe('git clone https://************@github.com/acme/app failed');
    });

    it('masks other fields, keys and numbers, and keeps metadata fields', async () => {
      const job = { env: { TOKEN_COPY: 'secret-token', 'secret-token': 'key', PIN: 123456789 } };
      const logs = await logWithSecretAsync(logger => {
        logger.info({ job, source: 'stdout', buildStepId: 'step-1' }, 'Builder is ready');
      });

      expect(logs[0].job).toEqual({
        env: { TOKEN_COPY: '************', '************': 'key', PIN: '*********' },
      });
      expect(logs[0].source).toBe('stdout');
      expect(logs[0].buildStepId).toBe('step-1');
      // The caller's object, which bunyan also hands to other streams, is not changed.
      expect(job.env.TOKEN_COPY).toBe('secret-token');
    });

    it('masks what a toJSON method returns', async () => {
      const logs = await logWithSecretAsync(logger => {
        logger.error(
          {
            err: {
              token: 'secret-token',
              toJSON: () => ({ token: 'secret-token', at: new Date(0) }),
            },
          },
          'failed'
        );
      });

      expect(logs[0].err).toEqual({ token: '************', at: '1970-01-01T00:00:00.000Z' });
    });

    it('truncates deeply nested values instead of uploading them unmasked', async () => {
      let nested: any = { token: 'secret-token' };
      for (let index = 0; index < 30; index++) {
        nested = { nested };
      }
      const logs = await logWithSecretAsync(logger => {
        logger.error({ err: nested }, 'failed');
      });

      expect(JSON.stringify(logs[0].err)).toContain('[Truncated]');
    });
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

describe('createLogMaskingStream', () => {
  async function maskAsync(stream: Transform, chunks: Buffer[]): Promise<Buffer> {
    const output: Buffer[] = [];
    await pipeline(
      Readable.from(chunks),
      stream,
      new Writable({
        write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
          output.push(chunk);
          callback();
        },
      })
    );
    return Buffer.concat(output);
  }

  it('masks secrets, secrets as Xcode prints them in build settings, and decoded secrets', async () => {
    const { createLogMaskingStream } = await createBuildLoggerWithSecretsFilter({
      environmentSecrets: [
        { name: 'API_KEY', value: 'ab cd=ef$gh', type: EnvironmentSecretType.STRING },
        {
          name: 'ANOTHER_SECRET_BASE64',
          value: 'YW5vdGhlclNlY3JldA==',
          type: EnvironmentSecretType.STRING,
        },
      ],
    });
    const log = [
      '    export API_KEY\\=ab\\ cd\\=ef\\$gh',
      'token is ab cd=ef$gh',
      'decoded anotherSecret here',
      '',
    ].join('\n');

    const masked = await maskAsync(createLogMaskingStream(), [Buffer.from(log)]);

    expect(masked.toString()).toBe(
      [
        `    export API_KEY\\=${'*'.repeat(14)}`,
        `token is ${'*'.repeat(11)}`,
        `decoded ${'*'.repeat(13)} here`,
        '',
      ].join('\n')
    );
  });

  it('masks secrets split across chunks, including masks added after the logger was created', async () => {
    const { createLogMaskingStream, addBuildLogMask } = await createBuildLoggerWithSecretsFilter(
      {}
    );
    addBuildLogMask('leased-token');

    const masked = await maskAsync(createLogMaskingStream(), [
      Buffer.from('first line leased-'),
      Buffer.from('token\nsecond '),
      Buffer.from('leased-token without a newline'),
    ]);

    expect(masked.toString()).toBe(
      `first line ${'*'.repeat(12)}\nsecond ${'*'.repeat(12)} without a newline`
    );
  });

  it('keeps everything except secrets byte for byte, including multibyte and invalid UTF-8', async () => {
    const { createLogMaskingStream } = await createBuildLoggerWithSecretsFilter({
      environmentSecrets: [
        { name: 'PASSWORD', value: 'pässwörd', type: EnvironmentSecretType.STRING },
      ],
    });
    const log = Buffer.concat([
      Buffer.from('✓ Compiling café.swift\r\n'),
      Buffer.from([0xff, 0xfe, 0x0a]),
      Buffer.from('password: pässwörd\n'),
    ]);
    // Split inside the multibyte characters.
    const chunks = [
      log.subarray(0, 1),
      log.subarray(1, 20),
      log.subarray(20, 40),
      log.subarray(40),
    ];

    const masked = await maskAsync(createLogMaskingStream(), chunks);

    const passwordBytes = Buffer.byteLength('pässwörd');
    expect(masked).toEqual(
      Buffer.concat([
        Buffer.from('✓ Compiling café.swift\r\n'),
        Buffer.from([0xff, 0xfe, 0x0a]),
        Buffer.from(`password: ${'*'.repeat(passwordBytes)}\n`),
      ])
    );
    expect(masked.length).toBe(log.length);
  });
});
