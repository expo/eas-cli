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

  return new Transform({
    readableObjectMode: true,
    writableObjectMode: true,
    transform(_chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
      let chunk = _chunk;
      if (chunk && typeof chunk === 'object') {
        // Remove hostname from logs since we don't need it.
        const { hostname: _hostname, ...rest } = chunk;
        chunk = {
          ...rest,
          // Add logId to each log.
          logId: uuidv7(),
        };
      }

      if (chunk && typeof chunk === 'object' && chunk.msg) {
        const msgWithoutSecrets = secretList.reduce((acc: string, pattern: string): string => {
          return acc.replaceAll(pattern, '*'.repeat(pattern.length));
        }, chunk.msg as string);

        callback(null, {
          ...chunk,
          msg: msgWithoutSecrets,
        });
      } else {
        callback(null, chunk);
      }
    },
  });
}

function createStdoutStream(): Writable {
  return new Writable({
    objectMode: true,
    write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      process.stdout.write(`${JSON.stringify(chunk)}\n`, callback);
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
