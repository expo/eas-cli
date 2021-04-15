import chalk from 'chalk';
import got from 'got';

import { SubmissionFragment, SubmissionStatus } from '../../graphql/generated';
import { default as LogModule } from '../../log';
import { printSubmissionError } from './errors';

export async function displayLogs(
  submission: SubmissionFragment | null,
  status: SubmissionStatus | null,
  verbose: boolean
): Promise<void> {
  let printedUnknownError = false;
  if (status === SubmissionStatus.Errored && submission?.error) {
    printedUnknownError = printSubmissionError(submission.error);
  }
  if ((printedUnknownError || verbose) && submission) {
    await downloadAndPrintSubmissionLogs(submission);
  }
}

async function downloadAndPrintSubmissionLogs(submission: SubmissionFragment): Promise<void> {
  if (!submission.logsUrl) {
    return;
  }
  const { body: data } = await got.get(submission.logsUrl);
  const logs = parseLogs(data);
  LogModule.addNewLineIfNone();
  const prefix = chalk.blueBright('[logs] ');
  for (const { level, msg } of logs) {
    const msgWithPrefix = `${prefix}${msg}`;
    if (level === 'error') {
      LogModule.error(msgWithPrefix);
    } else if (level === 'warn') {
      LogModule.warn(msgWithPrefix);
    } else {
      LogModule.log(msgWithPrefix);
    }
  }
}

interface Log {
  level: 'error' | 'warn' | 'info';
  msg: string;
}

function parseLogs(logs: string): Log[] {
  const lines = logs.split('\n');
  const result: Log[] = [];
  for (const line of lines) {
    let parsedLine;
    try {
      parsedLine = JSON.parse(line);
    } catch (error) {
      continue;
    }
    let level: Log['level'];
    const { level: levelNumber, msg } = parsedLine;
    if (levelNumber >= 50) {
      level = 'error';
    } else if (levelNumber >= 40) {
      level = 'warn';
    } else {
      level = 'info';
    }
    result.push({ level, msg });
  }
  return result;
}
