import chalk from 'chalk';

import { buildAsync } from './build';
import { checkRuntimeAsync } from './checkRuntime';
import { listenForInterrupts, shouldExit } from './exit';
import { parseInputAsync } from './parseInput';

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
