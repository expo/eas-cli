#!/usr/bin/env node

import { Spec } from 'arg';
import chalk from 'chalk';

import { assertWithOptionsArgs, printHelp, resolveStringOrBooleanArgsAsync } from './utils/args';
import { Log } from './log';
import { ExitError } from './error';
import shouldUpdate from './utils/updateCheck';

async function run(): Promise<void> {
  const argv = process.argv.slice(2) ?? [];
  const rawArgsMap: Spec = {
    // Types
    '--version': Boolean,
    '--help': Boolean,
    '--no-install': Boolean,
    // Aliases
    '-v': '--version',
    '-h': '--help',
  };
  const args = assertWithOptionsArgs(rawArgsMap, {
    argv,
    permissive: true,
  });

  if (args['--version']) {
    Log.exit(require('../package.json').version, 0);
  }

  if (args['--help']) {
    printHelp(
      `Creates EAS Build custom function module`,
      chalk`npx create-eas-build-function {cyan <path>} [options]`,
      [
        `    --no-install      Skip installing npm packages`,
        chalk`-t, --template {gray [pkg]}  NPM template to use: typescript, javascript. Default: typescript`,
        `-v, --version         Version number`,
        `-h, --help            Usage info`,
      ].join('\n'),
      chalk`
    {gray To choose a template pass in the {bold --template} arg:}

    {gray $} npx create-eas-build-function {cyan --template}

    {gray The package manager used for installing}
    {gray node modules is based on how you invoke the CLI:}

    {bold  npm:} {cyan npx create-eas-build-function}
    {bold yarn:} {cyan yarn create eas-custom-function-module}
    {bold pnpm:} {cyan pnpm create eas-custom-function-module}
    `
    );
  }

  try {
    const parsed = resolveStringOrBooleanArgsAsync(argv, rawArgsMap, {
      '--template': Boolean,
      '-t': '--template',
    });

    const { createAsync } = await import('./createAsync');
    await createAsync(parsed.projectRoot, {
      template: parsed.args['--template'],
      install: !args['--no-install'],
    });
  } catch (error: any) {
    // ExitError has already been logged, all others should be logged before exiting.
    if (!(error instanceof ExitError)) {
      Log.exception(error);
    }
  } finally {
    await shouldUpdate();
  }
}

void run();
