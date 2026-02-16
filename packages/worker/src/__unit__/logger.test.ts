import { TransformCallback, Writable } from 'node:stream';
import { createBuildLoggerWithSecretsFilter } from '../logger';
import z from 'zod';
import { EnvironmentSecretType } from '@expo/eas-build-job';

async function waitForStreamFlush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

describe('logger', () => {
  it('obfuscates secrets in logs', async () => {
    const { logger, outputStream } = await createBuildLoggerWithSecretsFilter([
      { name: 'TEST_SECRET', value: 'secret', type: EnvironmentSecretType.STRING },
      {
        name: 'ANOTHER_SECRET_BASE64',
        value: 'YW5vdGhlclNlY3JldA==',
        type: EnvironmentSecretType.STRING,
      },
    ]);

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
    const { logger, outputStream } = await createBuildLoggerWithSecretsFilter([]);

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

  it('drains transformed logs even without explicit output consumer', async () => {
    const { logger, outputStream } = await createBuildLoggerWithSecretsFilter([]);

    logger.info('Test log');
    logger.info('Test log');
    logger.info('Test log');

    await waitForStreamFlush();

    expect(outputStream.readableLength).toBe(0);
  });
});
