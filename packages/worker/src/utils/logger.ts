import { randomUUID } from 'crypto';
import { Transform, Writable } from 'stream';

import { BuildPhase } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { GCSLoggerStream } from '@expo/build-tools';

export interface LoggerStream extends Writable {
  writable: boolean;
  init(): Promise<string>;
  cleanUp(): Promise<void>;
  write(rec: any): boolean;
}

export interface BuildLogger {
  logger: bunyan;
  stream?: LoggerStream;
}

export function makeKeyForBuildLogs(prefix: string): string {
  return `${prefix}/${Date.now()}-${randomUUID()}.txt`;
}

async function createBuildLogger(logger: bunyan, stream?: NodeJS.WritableStream): Promise<bunyan> {
  const fields =
    'phase' in (logger.fields as Record<string, any>) ? {} : { phase: BuildPhase.UNKNOWN };

  const childLogger = logger.child(fields);
  if (stream) {
    childLogger.addStream({
      type: 'raw',
      stream,
      reemitErrorEvents: true,
      level: logger.level(),
    });
  }

  return childLogger;
}

export async function createGCSBuildLogger({
  transformStream,
  ...config
}: GCSLoggerStream.Config & { transformStream?: Transform }): Promise<BuildLogger> {
  if (config.uploadMethod) {
    const stream = new GCSLoggerStream(config);
    transformStream?.pipe(stream);
    await stream.init();
    const logger = await createBuildLogger(config.logger, transformStream ?? stream);
    return {
      logger,
      stream,
    };
  } else {
    return { logger: await createBuildLogger(config.logger) };
  }
}
