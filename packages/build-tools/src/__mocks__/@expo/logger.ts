import bunyan from 'bunyan';

export function createLogger(): bunyan {
  const logger = {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: () => {},
    child: (_fields) => logger,
  } as bunyan;
  return logger;
}

export enum LoggerLevel {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}
