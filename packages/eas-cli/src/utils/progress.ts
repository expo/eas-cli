import chalk from 'chalk';
import { Progress } from 'got';
import ora from 'ora';

import { endTimer, formatMilliseconds, startTimer } from './timer';

type ProgressHandler = (props: {
  progress?: Progress;
  isComplete?: boolean;
  error?: Error;
}) => void;

function createProgressTracker({
  total,
  message,
  completedMessage,
}: {
  total?: number;
  message: string | ((ratio: number) => string);
  completedMessage: string;
}): ProgressHandler {
  let bar: ora.Ora | null = null;
  let calcTotal: number = total ?? 0;
  let transferredSoFar = 0;
  let current = 0;

  const timerLabel = String(Date.now());

  const getMessage = (v: number) => {
    const ratio = Math.min(Math.max(v, 0), 1);
    const percent = Math.floor(ratio * 100);
    return typeof message === 'string' ? `${message} ${percent.toFixed(0)}%` : message(ratio);
  };

  return ({ progress, isComplete, error }) => {
    if (progress) {
      if (!bar && (progress.total !== undefined || total !== undefined)) {
        calcTotal = (total ?? progress.total) as number;
        bar = ora(getMessage(0)).start();
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

        bar.text = getMessage(percentage);
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
        bar.succeed(`${completedMessage} ${chalk.dim(prettyTime)}`);
      }
    }
  };
}

export { createProgressTracker };
