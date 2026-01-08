import bunyan from 'bunyan';

import LoggerLevel from './level';
import { pipe, pipeSpawnOutput, PipeMode, PipeOptions } from './pipe';

const DEFAULT_LOGGER_NAME = 'expo-logger';

function createLogger(options: bunyan.LoggerOptions): bunyan {
  return bunyan.createLogger({
    serializers: bunyan.stdSerializers,
    ...options,
  });
}

const defaultLogger = createLogger({
  name: DEFAULT_LOGGER_NAME,
  level: LoggerLevel.INFO,
});

export default defaultLogger;
export { LoggerLevel, createLogger, pipe, pipeSpawnOutput, PipeMode, PipeOptions };
export type { bunyan };
