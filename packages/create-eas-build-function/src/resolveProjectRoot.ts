#!/usr/bin/env node

import path from 'path';
import fs from 'fs';

import chalk from 'chalk';
import prompts from 'prompts';

import { Log } from './log';
import { getConflictsForDirectory } from './utils/dir';
import { formatSelfCommand } from './resolvePackageManager';

export function assertFolderEmpty(projectRoot: string, folderName: string): void {
  const conflicts = getConflictsForDirectory(projectRoot);
  if (conflicts.length) {
    Log.log(chalk`The directory {cyan ${folderName}} has files that might be overwritten:`);
    Log.log();
    for (const file of conflicts) {
      Log.log(`  ${file}`);
    }
    Log.log();
    Log.exit('Try using a new directory name, or moving these files.\n');
  }
}

const FORBIDDEN_NAMES = [
  'react-native',
  'react',
  'react-dom',
  'react-native-web',
  'expo',
  'expo-router',
];

export function assertValidName(folderName: string): void {
  const validation = validateName(folderName);
  if (typeof validation === 'string') {
    Log.exit(chalk`{red Cannot create an app named {bold "${folderName}"}. ${validation}}`, 1);
  }
  const isForbidden = isFolderNameForbidden(folderName);
  if (isForbidden) {
    Log.exit(
      chalk`{red Cannot create an app named {bold "${folderName}"} because it would conflict with a dependency of the same name.}`,
      1
    );
  }
}

export async function resolveProjectRootAsync(input: string): Promise<string> {
  let name = input?.trim();

  if (!name) {
    const { answer } = await prompts({
      type: 'text',
      name: 'answer',
      message: 'What is your EAS Build function named?',
      initial: 'my-function',
      validate: (name) => {
        const validation = validateName(path.basename(path.resolve(name)));
        if (typeof validation === 'string') {
          return 'Invalid project name: ' + validation;
        }
        return true;
      },
    });

    if (typeof answer === 'string') {
      name = answer.trim();
    }
  }

  if (!name) {
    const selfCmd = formatSelfCommand();
    Log.log();
    Log.log('Please choose your app name:');
    Log.log(chalk`  {dim $} {cyan ${selfCmd} <name>}`);
    Log.log();
    Log.log(`For more info, run:`);
    Log.log(chalk`  {dim $} {cyan ${selfCmd} --help}`);
    Log.log();
    Log.exit('');
  }

  const projectRoot = path.resolve(name);
  const folderName = path.basename(projectRoot);

  assertValidName(folderName);

  await fs.promises.mkdir(projectRoot, { recursive: true });

  assertFolderEmpty(projectRoot, folderName);

  return projectRoot;
}

function validateName(name?: string): string | true {
  if (typeof name !== 'string' || name === '') {
    return 'The project name can not be empty.';
  }
  if (!/^[a-z0-9@.\-_]+$/i.test(name)) {
    return 'The project name can only contain URL-friendly characters.';
  }
  return true;
}

function isFolderNameForbidden(folderName: string): boolean {
  return FORBIDDEN_NAMES.includes(folderName);
}
