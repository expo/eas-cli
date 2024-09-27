import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';

import Log from '../log';
import { Ora, ora } from '../ora';

export async function runCommandAsync({
  cwd,
  args,
  command,
  shouldShowStderrLine,
  shouldPrintStderrLineAsStdout,
  showSpinner = true,
}: {
  cwd?: string;
  args: string[];
  command: string;
  shouldShowStderrLine?: (line: string) => boolean;
  shouldPrintStderrLineAsStdout?: (line: string) => boolean;
  showSpinner?: boolean;
}): Promise<void> {
  Log.log(`🏗️  Running ${chalk.bold(`${command} ${args.join(' ')}`)}...`);
  let spinner: Ora | undefined;
  if (showSpinner) {
    spinner = ora(`${chalk.bold(`${command} ${args.join(' ')}`)}`).start();
  }
  const spawnPromise = spawnAsync(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd,
  });
  const {
    child: { stdout, stderr },
  } = spawnPromise;
  if (!stdout || !stderr) {
    throw new Error(`Failed to spawn ${command}`);
  }

  stdout.on('data', data => {
    for (const line of data.toString().trim().split('\n')) {
      Log.log(`${chalk.gray(`[${command}]`)} ${line}`);
    }
  });
  stderr.on('data', data => {
    for (const line of data.toString().trim().split('\n')) {
      if (shouldShowStderrLine && !shouldShowStderrLine(line)) {
        continue;
      }

      const log = `${chalk.gray(`[${command}]`)} ${line}`;
      if (shouldPrintStderrLineAsStdout?.(line)) {
        Log.log(log);
      } else {
        Log.warn(`${chalk.gray(`[${command}]`)} ${line}`);
      }
    }
  });

  try {
    await spawnPromise;
  } catch (error) {
    if (showSpinner) {
      spinner?.fail(`${chalk.bold(`${command} ${args.join(' ')}`)} failed`);
    } else {
      Log.error(`❌ ${chalk.bold(`${command} ${args.join(' ')}`)} failed`);
    }
    throw error;
  }

  if (showSpinner) {
    spinner?.succeed(`${chalk.bold(`${command} ${args.join(' ')}`)} succeeded`);
  } else {
    Log.log(`✅ ${chalk.bold(`${command} ${args.join(' ')}`)} succeeded`);
  }
  Log.log('');
}
