import { HttpLogStream, LogBuffer, RemoteLoggerStream } from '@expo/build-tools';
import { BuildPhase, EnvironmentSecret, Job } from '@expo/eas-build-job';
import { LoggerLevel, bunyan, createLogger } from '@expo/logger';
import { Readable, Transform, TransformCallback, Writable } from 'stream';

import config from './config';
import { maybeStringBase64Decode, simpleSecretsWhitelist } from './secrets';
import { uuidv7 } from 'uuidv7';

const defaultLogger = createLogger({
  name: config.loggers.base.name,
  level: LoggerLevel.INFO,
});

const MAX_LINES_IN_BUFFER = 100;

interface CachedLog {
  msg: string;
  phase: string;
}

export class WorkerLogBuffer extends Writable implements LogBuffer {
  public writable: boolean = true;
  public buffer: CachedLog[] = [];

  constructor(private readonly numberOfLines: number) {
    super();
  }

  public write(rec: any): boolean {
    if (
      // verify required fields
      typeof rec !== 'object' ||
      typeof rec?.msg !== 'string' ||
      typeof rec?.phase !== 'string' ||
      // use only logs from spawn commands
      (rec?.source !== 'stdout' && rec?.source !== 'stderr') ||
      // skip all short lines (it could potentially be some loader)
      (rec?.msg ?? '').length < 3
    ) {
      return true;
    }
    if (this.buffer.length >= this.numberOfLines) {
      this.buffer.shift();
    }
    this.buffer.push({ msg: rec.msg, phase: rec.phase });
    return true;
  }

  public getLogs(): string[] {
    return this.buffer.map(({ msg }) => msg);
  }

  public getPhaseLogs(buildPhase: string): string[] {
    return this.buffer.filter(({ phase }) => phase === buildPhase).map(({ msg }) => msg);
  }
}

function createTransformStream(secrets: EnvironmentSecret[]): Transform {
  const secretValues = secrets.map(({ value }) => value);
  const secretList: string[] = [
    ...secretValues,
    ...secretValues.map(maybeStringBase64Decode).filter((i): i is string => !!i),
  ].filter(i => i.length > 1 && !simpleSecretsWhitelist.includes(i));
  const maskSecrets = (value: string): string =>
    secretList.reduce((acc: string, pattern: string): string => {
      return acc.replaceAll(pattern, '*'.repeat(pattern.length));
    }, value);

  return new Transform({
    readableObjectMode: true,
    writableObjectMode: true,
    transform(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
      if (!chunk || typeof chunk !== 'object') {
        callback(null, chunk);
        return;
      }
      // Remove hostname from logs since we don't need it.
      const { hostname: _hostname, ...rest } = chunk;
      callback(
        null,
        toMaskedJsonRecord(
          {
            ...rest,
            // Add logId to each log.
            logId: uuidv7(),
          },
          maskSecrets
        )
      );
    },
  });
}

// Set by the logger and build tooling rather than by build output. Masking them could
// break grouping and filtering, e.g. a secret equal to "stdout" or part of a timestamp.
const UNMASKED_RECORD_FIELDS = new Set([
  'name',
  'pid',
  'level',
  'time',
  'v',
  'logId',
  'phase',
  'source',
  'buildStepId',
  'buildStepInternalId',
  'marker',
  'result',
]);

// Every destination writes records as JSON, so return a plain JSON value with secrets
// masked in every string, not only in `msg`. Like bunyan's own stdout stream, tolerate
// values JSON.stringify rejects instead of throwing into the code that logged.
function toMaskedJsonRecord(
  record: Record<string, unknown>,
  maskSecrets: (value: string) => string
): Record<string, unknown> {
  const createReplacer = (seen?: WeakSet<object>) =>
    function (this: unknown, key: string, value: unknown): unknown {
      if (typeof value === 'bigint') {
        value = value.toString();
      }
      if (this === record && UNMASKED_RECORD_FIELDS.has(key)) {
        return value;
      }
      if (typeof value === 'string') {
        return maskSecrets(value);
      }
      if (seen && value && typeof value === 'object') {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    };

  try {
    return JSON.parse(JSON.stringify(record, createReplacer()));
  } catch {}
  try {
    return JSON.parse(JSON.stringify(record, createReplacer(new WeakSet())));
  } catch {}
  // Something like a throwing toJSON(); keep the top-level values that are safe to log.
  const fallback: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      fallback[key] = UNMASKED_RECORD_FIELDS.has(key) ? value : maskSecrets(value);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      fallback[key] = value;
    } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
      fallback[key] = value.toISOString();
    }
  }
  return fallback;
}

function createStdoutStream(): Writable {
  return new Writable({
    objectMode: true,
    write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      // Like bunyan's stdout stream, do not wait for stdout to flush. The other
      // destinations are piped from the same source and would wait with it.
      process.stdout.write(`${JSON.stringify(chunk)}\n`);
      callback();
    },
  });
}

export async function createBuildLoggerWithSecretsFilter(secrets: Job['secrets']): Promise<{
  logger: bunyan;
  cleanUp: () => Promise<void>;
  logBuffer: WorkerLogBuffer;
  outputStream: Readable;
}> {
  const transformStream = createTransformStream(secrets?.environmentSecrets ?? []);
  transformStream.pipe(createStdoutStream());

  // Do not inherit defaultLogger's stdout stream: every build-log destination must
  // receive the filtered record.
  const buildLogger = createLogger({
    name: config.loggers.base.name,
    phase: BuildPhase.UNKNOWN,
    level: defaultLogger.level(),
    streams: [{ type: 'raw', stream: transformStream, reemitErrorEvents: true }],
  });

  let remoteLoggerStream: RemoteLoggerStream | null = null;
  if (config.loggers.gcs.signedUploadUrlForLogs) {
    remoteLoggerStream = new RemoteLoggerStream({
      uploadMethod: { signedUrl: config.loggers.gcs.signedUploadUrlForLogs },
      options: {
        uploadIntervalMs: config.loggers.gcs.uploadIntervalMs,
        compress: config.loggers.gcs.compressionMethod,
      },
      logger: defaultLogger,
    });
    transformStream.pipe(remoteLoggerStream);
    await remoteLoggerStream.init();
  }

  const logBuffer = new WorkerLogBuffer(MAX_LINES_IN_BUFFER);
  transformStream.pipe(logBuffer);

  let httpLogStream: HttpLogStream | null = null;
  if (config.loggers.http.baseUrl && secrets?.robotAccessToken) {
    httpLogStream = new HttpLogStream({
      url: new URL(config.buildId, config.loggers.http.baseUrl).toString(),
      headers: {
        Authorization: `Bearer ${secrets.robotAccessToken}`,
      },
      logger: defaultLogger,
      bufferRetentionMs: config.loggers.gcs.signedUploadUrlForLogs
        ? Math.max(30_000, config.loggers.gcs.uploadIntervalMs * 2)
        : null,
    });
    transformStream.pipe(httpLogStream);
  }

  return {
    logger: buildLogger,
    cleanUp: async () => {
      await Promise.all([remoteLoggerStream?.cleanUp?.(), httpLogStream?.cleanUp?.()]);
    },
    outputStream: transformStream,
    logBuffer,
  };
}

export default defaultLogger;
