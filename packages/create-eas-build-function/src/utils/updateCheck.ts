#!/usr/bin/env node

import chalk from 'chalk';
import checkForUpdate from 'update-check';

import { Log } from '../log';

const packageJson = require('../package.json');

export default async function shouldUpdate(): Promise<void> {
  try {
    const res = await checkForUpdate(packageJson);
    if (res?.latest) {
      Log.log();
      Log.log(chalk.yellow.bold(`A new version of \`${packageJson.name}\` is available`));
      Log.log(chalk`You can update by running: {cyan npm install -g ${packageJson.name}}`);
      Log.log();
    }
  } catch {}
}
