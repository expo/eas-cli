import { TransformCallback, Writable } from 'node:stream';
import { EnvironmentSecretType } from '@expo/eas-build-job';
import { Response } from 'node-fetch';
import fetch from 'node-fetch';
import z from 'zod';

import config from '../config';
import { createBuildLoggerWithSecretsFilter } from '../logger';

jest.mock('node-fetch', () => {
  const actual = jest.requireActual('node-fetch');
  return {
    __esModule: true,
    ...actual,
    default: jest.fn(),
  };
});

async function waitForStreamFlush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

const fetchMock = jest.mocked(fetch);

describe('logger', () => {
  const originalHttpBaseUrl = config.loggers.http.baseUrl;
  const originalBuildId = config.buildId;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('', { status: 200, statusText: 'OK' }));
  });

  afterEach(() => {
    config.loggers.http.baseUrl = originalHttpBaseUrl;
    config.buildId = originalBuildId;
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://logs.expo.test/logs/build-id',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer robot-token',
          'Content-Type': 'application/x-ndjson',
        }),
      })
    );

    const [, requestInit] = fetchMock.mock.calls[0];
    const [serializedLog] = String(requestInit?.body).split('\n');
    const uploadedLog = JSON.parse(serializedLog);

    expect(uploadedLog.logId).toBe(logs[0].logId);
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
