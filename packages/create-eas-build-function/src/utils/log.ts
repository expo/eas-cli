#!/usr/bin/env node

import ora, { Ora } from 'ora';

export function withSectionLog<T>(
  action: (spinner: Ora) => Promise<T>,
  message: {
    pending: string;
    success: string;
    error: (errror: Error) => string;
  }
): Promise<T> {
  const spinner = ora({
    text: message.pending,
    // In non-interactive mode, send the stream to stdout so it prevents looking like an error.
    stream: process.stderr,
  });

  spinner.start();

  return action(spinner).then(
    (result) => {
      spinner.succeed(message.success);
      return result;
    },
    (error) => {
      spinner.fail(message.error(error));
      throw error;
    }
  );
}
