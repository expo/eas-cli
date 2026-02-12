import { TransformCallback, Writable } from 'node:stream';
import { createBuildLoggerWithSecretsFilter } from '../logger';
import z from 'zod';

describe('logger', () => {
  it('adds logId to each log', async () => {
    const { logger, outputStream } = await createBuildLoggerWithSecretsFilter([]);

    const logs: any[] = [];

    let resolveWrites!: () => void;
    const writesDone = new Promise<void>(resolve => {
      resolveWrites = resolve;
    });

    const writable = new Writable({
      objectMode: true,
      write(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
        logs.push(chunk);
        if (logs.length === 2) {
          resolveWrites();
        }

        callback(null, chunk);
      },
    });

    outputStream.pipe(writable);

    logger.info('Test log');
    logger.info('Test log');

    await writesDone;

    expect(logs.length).toBe(2);

    for (const log of logs) {
      expect(log.logId).toBeDefined();
      expect(z.uuidv7().parse(log.logId)).toBe(log.logId);
    }

    expect(logs[0].logId).not.toBe(logs[1].logId);
  });
});
