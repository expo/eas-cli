import { GCSLoggerStream } from '@expo/build-tools';
import { BuildPhase } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { Transform } from 'stream';

export interface BuildLogger {
  logger: bunyan;
  cleanUp?: () => Promise<void>;
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

    const cleanUp = async () => {
      await stream.cleanUp();
    };

    return {
      logger,
      cleanUp,
    };
  } else {
    return { logger: await createBuildLogger(config.logger) };
  }
}
