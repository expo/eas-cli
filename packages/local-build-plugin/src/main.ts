import chalk from 'chalk';

import { parseInputAsync } from './parseInput';
import { buildAsync } from './build';
import { listenForInterrupts, shouldExit } from './exit';
import { checkRuntimeAsync } from './checkRuntime';

listenForInterrupts();

async function main(): Promise<void> {
  try {
    const { job, metadata } = await parseInputAsync();
    await checkRuntimeAsync(job);
    await buildAsync(job, metadata);
  } catch (err: any) {
    if (!shouldExit()) {
      console.error(chalk.red(err.message));
      console.log(err.stack);
      process.exit(1);
    }
  }
}

void main();
