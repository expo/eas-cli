import chalk from 'chalk';

import { printSubmissionError } from './errors';
import fetch from '../../fetch';
import { SubmissionFragment, SubmissionStatus } from '../../graphql/generated';
import Log from '../../log';

export async function displayLogsAsync(
  submission: SubmissionFragment,
  { verbose = false, moreSubmissions = false } = {}
): Promise<void> {
  let printedUnknownError = false;
  if (submission.status === SubmissionStatus.Errored && submission.error) {
    printedUnknownError = printSubmissionError(submission.error);
  } else if (submission.status === SubmissionStatus.Canceled && moreSubmissions) {
    Log.newLine();
    Log.error('Submission has been canceled');
  }
  if (printedUnknownError || verbose) {
    await downloadAndPrintSubmissionLogsAsync(submission);
  }
}

async function downloadAndPrintSubmissionLogsAsync(submission: SubmissionFragment): Promise<void> {
  for (const logFile of submission.logFiles) {
    const response = await fetch(logFile);
    const logs = parseLogs(await response.text());
    Log.addNewLineIfNone();
    const prefix = chalk.blueBright('[logs] ');
    for (const { level, msg } of logs) {
      const msgWithPrefix = `${prefix}${msg}`;
      if (level === 'error') {
        Log.error(msgWithPrefix);
      } else if (level === 'warn') {
        Log.warn(msgWithPrefix);
      } else {
        Log.log(msgWithPrefix);
      }
    }
  }
}

interface LogLine {
  level: 'error' | 'warn' | 'info';
  msg: string;
}

function parseLogs(logs: string): LogLine[] {
  const lines = logs.split('\n');
  const result: LogLine[] = [];
  for (const line of lines) {
    let parsedLine;
    try {
      parsedLine = JSON.parse(line);
    } catch {
      continue;
    }
    let level: LogLine['level'];
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
