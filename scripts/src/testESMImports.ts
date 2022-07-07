/* eslint-disable no-console */
// source: https://gist.github.com/PabloSzx/6f9a34a677e27d2ee3e4826d02490083

import chalk from 'chalk';
import { globby } from 'globby';
import path from 'path';

async function mainAsync(globPattern: string): Promise<void> {
  const mjsFiles = await globby(globPattern, {
    cwd: process.cwd(),
  });

  const ok: string[] = [];
  const fail: string[] = [];

  let i = 0;
  for (const mjsFile of mjsFiles) {
    try {
      const absolutePath = path.join(process.cwd(), mjsFile);
      await import(absolutePath);
      ok.push(mjsFile);
    } catch (err) {
      const color = i++ % 2 === 0 ? chalk.magenta : chalk.red;
      console.error(color(`\n\n-----\n${i}) ${mjsFile}\n`));
      console.error(err);
      console.error(color('\n-----\n\n'));
      fail.push(mjsFile);
    }
  }

  if (fail.length > 0) {
    console.error(chalk.red(`${fail.length} Fail: ${fail.join(' | ')}`));
  }

  if (fail.length > 0) {
    console.error('\nFAILED');
    process.exit(1);
  } else if (ok.length > 0) {
    console.error('\nOK');
    process.exit(0);
  } else {
    console.error('No files analyzed!');
    process.exit(1);
  }
}

try {
  const globPattern = process.argv[2];
  if (!globPattern) {
    throw new Error('Provide glob pattern');
  }
  await mainAsync(globPattern);
} catch (err) {
  console.error(err);
  process.exit(1);
}
