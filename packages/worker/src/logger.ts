import { Transform, TransformCallback, Writable } from 'stream';

import { LoggerLevel, createLogger } from '@expo/logger';
import { BuildLogger as CommonBuildLogger, createGCSBuildLogger } from '@expo/turtle-common';
import { LogBuffer } from '@expo/build-tools';
import { EnvironmentSecret } from '@expo/eas-build-job';

import config from './config';
import { maybeStringBase64Decode, simpleSecretsWhitelist } from './secrets';

export interface BuildLogger extends CommonBuildLogger {
  logBuffer: LogBuffer;
}

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

function createSecretMaskingStream(secrets: EnvironmentSecret[]): Transform {
  const secretValues = secrets.map(({ value }) => value);
  const secretList: string[] = [
    ...secretValues,
    ...secretValues.map(maybeStringBase64Decode).filter((i): i is string => !!i),
  ].filter((i) => i.length > 1 && !simpleSecretsWhitelist.includes(i));
  return new Transform({
    readableObjectMode: true,
    writableObjectMode: true,
    transform(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
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

export async function createBuildLoggerWithSecretsFilter(
  secrets?: EnvironmentSecret[]
): Promise<BuildLogger> {
  const logBuffer = new WorkerLogBuffer(MAX_LINES_IN_BUFFER);
  const childLogger = defaultLogger.child({ service: 'worker' });

  const { logger, stream } = await createGCSBuildLogger({
    uploadMethod: config.loggers.gcs.signedUploadUrlForLogs
      ? { signedUrl: config.loggers.gcs.signedUploadUrlForLogs }
      : undefined,
    options: {
      uploadIntervalMs: config.loggers.base.uploadIntervalMs,
      compress: config.loggers.gcs.compressionMethod,
    },
    transformStream: secrets && createSecretMaskingStream(secrets),
    logger: childLogger,
  });

  logger.addStream({
    type: 'raw',
    stream: logBuffer,
    reemitErrorEvents: true,
    level: logger.level(),
  });

  return { logger, stream, logBuffer };
}

export default defaultLogger;
