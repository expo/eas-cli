import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

import bunyan from 'bunyan';

import defaultLogger, { LoggerLevel, PipeMode, createLogger, pipeSpawnOutput } from '../index';

// Collects raw bunyan records written to the logger.
function createRecordCollector(logger: ReturnType<typeof createLogger>): any[] {
  const records: any[] = [];
  logger.addStream({
    type: 'raw',
    stream: {
      write(record: any) {
        records.push(record);
      },
    } as any,
    level: bunyan.TRACE,
  });
  return records;
}

function createSilentLogger(): ReturnType<typeof createLogger> {
  const logger = createLogger({ name: 'test-logger', streams: [] });
  return logger;
}

describe(createLogger, () => {
  it('creates a logger that writes records with name, level, and msg', () => {
    const logger = createSilentLogger();
    const records = createRecordCollector(logger);

    logger.info('hello world');

    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('test-logger');
    expect(records[0].level).toBe(bunyan.INFO);
    expect(records[0].msg).toBe('hello world');
  });

  it('supports structured fields and util.format-style messages', () => {
    const logger = createSilentLogger();
    const records = createRecordCollector(logger);

    logger.info({ phase: 'INSTALL_DEPENDENCIES' }, 'step %d done', 2);

    expect(records[0].phase).toBe('INSTALL_DEPENDENCIES');
    expect(records[0].msg).toBe('step 2 done');
  });

  it('serializes errors with the standard err serializer', () => {
    const logger = createSilentLogger();
    const records = createRecordCollector(logger);

    logger.error(new Error('boom'));

    expect(records[0].err.message).toBe('boom');
    expect(records[0].err.stack).toEqual(expect.stringContaining('boom'));
    expect(records[0].msg).toBe('boom');
  });

  it('creates child loggers that inherit fields and add their own', () => {
    const logger = createSilentLogger();
    const records = createRecordCollector(logger);

    const child = logger.child({ source: 'stdout' });
    child.warn('from child');

    expect(records[0].name).toBe('test-logger');
    expect(records[0].source).toBe('stdout');
    expect(records[0].level).toBe(bunyan.WARN);
  });

  it('respects the configured level', () => {
    const logger = createLogger({ name: 'test-logger', streams: [] });
    const records: any[] = [];
    logger.addStream({
      type: 'raw',
      stream: {
        write(record: any) {
          records.push(record);
        },
      } as any,
      level: bunyan.INFO,
    });

    logger.debug('too quiet');
    logger.info('loud enough');

    expect(records).toHaveLength(1);
    expect(records[0].msg).toBe('loud enough');
  });

  it('reports and sets the level programmatically', () => {
    const logger = createLogger({
      name: 'test-logger',
      streams: [
        {
          type: 'raw',
          stream: { write() {} } as any,
          level: LoggerLevel.INFO,
        },
      ],
    });

    expect(logger.level()).toBe(bunyan.INFO);
    logger.level(LoggerLevel.DEBUG);
    expect(logger.level()).toBe(bunyan.DEBUG);
  });

  it('supports rotating-file streams', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'expo-logger-test-'));
    const logPath = path.join(directory, 'rotating.log');
    let rotatingStream: any;

    try {
      const logger = createLogger({
        name: 'test-logger',
        streams: [
          {
            type: 'rotating-file',
            path: logPath,
            period: '1d',
            count: 1,
          },
        ],
      });
      rotatingStream = (logger as any).streams[0].stream;

      logger.info('written to a rotating file');

      await new Promise<void>((resolve, reject) => {
        rotatingStream.stream.once('error', reject);
        rotatingStream.stream.end(resolve);
      });
      expect(await fs.promises.readFile(logPath, 'utf8')).toContain('written to a rotating file');
    } finally {
      clearTimeout(rotatingStream?.timeout);
      rotatingStream?.stream.destroy();
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  });
});

describe('defaultLogger', () => {
  it('is configured with the expo-logger name at INFO level', () => {
    expect(defaultLogger.fields.name).toBe('expo-logger');
    expect(defaultLogger.level()).toBe(bunyan.INFO);
  });
});

describe(pipeSpawnOutput, () => {
  async function pipeAndCollect(
    stdoutData: string | null,
    stderrData: string | null,
    options?: Parameters<typeof pipeSpawnOutput>[2]
  ): Promise<any[]> {
    const logger = createSilentLogger();
    const records = createRecordCollector(logger);
    const stdout = stdoutData === null ? null : Readable.from([stdoutData]);
    const stderr = stderrData === null ? null : Readable.from([stderrData]);
    pipeSpawnOutput(logger, { stdout, stderr }, options);
    await new Promise(resolve => setImmediate(resolve));
    return records;
  }

  it('logs stdout and stderr lines tagged with their source', async () => {
    const records = await pipeAndCollect('out line 1\nout line 2\n', 'err line\n');

    const stdoutRecords = records.filter(r => r.source === 'stdout');
    const stderrRecords = records.filter(r => r.source === 'stderr');
    expect(stdoutRecords.map(r => r.msg)).toEqual(['out line 1', 'out line 2']);
    expect(stderrRecords.map(r => r.msg)).toEqual(['err line']);
  });

  it('tags stderr as stdout in COMBINED_AS_STDOUT mode', async () => {
    const records = await pipeAndCollect('out\n', 'err\n', { mode: PipeMode.COMBINED_AS_STDOUT });

    expect(records).toHaveLength(2);
    expect(records.every(r => r.source === 'stdout')).toBe(true);
  });

  it('applies the line transformer and drops lines it nulls out', async () => {
    const records = await pipeAndCollect('keep\ndrop\n', null, {
      lineTransformer: line => (line === 'drop' ? null : `[prefix] ${line}`),
    });

    expect(records.map(r => r.msg)).toEqual(['[prefix] keep']);
  });
});
