import chalk from 'chalk';

import { endTimer, formatMilliseconds, startTimer } from './timer';
import { Ora, ora } from '../ora';

export type Progress = {
  total: number;
  percent: number;
  transferred: number;
};

export type ProgressHandler = (props: {
  progress?: Progress;
  isComplete?: boolean;
  error?: Error;
}) => void;

export function createProgressTracker({
  total,
  message,
  completedMessage,
}: {
  total?: number;
  message: string | ((ratio: number, total: number) => string);
  completedMessage: string | ((duration: string) => string);
}): ProgressHandler {
  let bar: Ora | null = null;
  let calcTotal: number = total ?? 0;
  let transferredSoFar = 0;
  let current = 0;

  const timerLabel = String(Date.now());

  const getMessage = (v: number, total: number): string => {
    const ratio = Math.min(Math.max(v, 0), 1);
    const percent = Math.floor(ratio * 100);
    return typeof message === 'string'
      ? `${message} ${percent.toFixed(0)}%`
      : message(ratio, total);
  };

  return ({ progress, isComplete, error }) => {
    if (progress) {
      if (!bar && (progress.total !== undefined || total !== undefined)) {
        calcTotal = total ?? progress.total;
        bar = ora(getMessage(0, calcTotal)).start();
        startTimer(timerLabel);
      }
      if (progress.total) {
        calcTotal = progress.total;
      }
      if (bar) {
        let percentage = 0;
        if (progress.percent) {
          percentage = progress.percent;
        } else {
          current += progress.transferred - transferredSoFar;
          percentage = current / calcTotal;
        }

        bar.text = getMessage(percentage, calcTotal);
      }
      transferredSoFar = progress.transferred;
    }

    if (!bar) {
      return;
    }

    if (isComplete) {
      const duration = endTimer(timerLabel);
      const prettyTime = formatMilliseconds(duration);
      if (error) {
        bar.fail();
      } else if (isComplete) {
        if (typeof completedMessage === 'string') {
          bar.succeed(`${completedMessage} ${chalk.dim(prettyTime)}`);
        } else {
          bar.succeed(completedMessage(prettyTime));
        }
      }
    }
  };
}
