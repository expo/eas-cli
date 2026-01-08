import { Writable } from 'stream';

import bunyan from 'bunyan';
import chalk from 'chalk';
import omit from 'lodash/omit';
import { LogBuffer } from '@expo/build-tools';
import { LoggerLevel } from '@expo/logger';

import config from './config';

interface Log {
  msg: string;
  level: number;
  err?: any;
  marker?: string;
  phase: string;
  source: 'stdout' | 'stderr';
  buildStepDisplayName?: string;
}
const MAX_LINES_IN_BUFFER = 100;

interface CachedLog {
  msg: string;
  phase: string;
}

class BuildCliLogBuffer extends Writable implements LogBuffer {
  public writable = true;
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

class PrettyStream extends Writable {
  write(rawLog: string): boolean {
    const log = JSON.parse(rawLog) as Log;
    if (log.marker) {
      return true;
    }
    const msg = this.formatMessage(log);
    if (log.level >= bunyan.ERROR || log.source === 'stderr') {
      console.error(msg);
    } else {
      console.log(msg);
    }

    const extraProperties = omit(log, [
      'msg',
      'err',
      'level',
      'phase',
      'marker',
      'source',
      'time',
      'id',
      'v',
      'pid',
      'hostname',
      'name',
      'buildStepInternalId',
      'buildStepId',
      'buildStepDisplayName',
    ]);
    if (Object.keys(extraProperties).length !== 0) {
      const str = JSON.stringify(extraProperties, null, 2);
      // substring removes `{\n` and `\n}`
      console.log(chalk.gray(str.substring(2, str.length - 2)));
    }
    if (log?.err?.stack) {
      console.error(chalk.red(log.err.stack));
    }
    return true;
  }

  private formatMessage(log: Log): string {
    const phase = this.getPhaseName(log);
    switch (log.level) {
      case bunyan.DEBUG:
        return `[${phase}] ${chalk.gray(log.msg)}`;
      case bunyan.INFO: {
        const msg = log.source === 'stderr' ? chalk.red(log.msg) : log.msg;
        return `[${phase}] ${msg}`;
      }
      case bunyan.WARN:
        return `[${phase}] ${chalk.yellow(log.msg)}`;
      case bunyan.ERROR:
        return `[${phase}] ${chalk.red(log.msg)}`;
      case bunyan.FATAL:
        return `[${phase}] ${chalk.red(log.msg)}`;
      default:
        return log.msg;
    }
  }

  private getPhaseName(log: Log): string {
    return log.phase === 'CUSTOM' && log.buildStepDisplayName
      ? log.buildStepDisplayName
      : log.phase;
  }
}

export const logBuffer = new BuildCliLogBuffer(MAX_LINES_IN_BUFFER);

export function createLogger(level?: LoggerLevel): bunyan {
  return bunyan.createLogger({
    name: 'eas-build-cli',
    serializers: bunyan.stdSerializers,
    streams: [
      {
        level: level ?? config.logger.defaultLoggerLevel,
        stream: new PrettyStream(),
      },
      {
        level: LoggerLevel.INFO,
        stream: logBuffer,
      },
    ],
  });
}
