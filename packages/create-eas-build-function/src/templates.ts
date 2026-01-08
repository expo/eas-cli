#!/usr/bin/env node

import path from 'path';

import fs from 'fs-extra';
import chalk from 'chalk';
import prompts from 'prompts';

import { Log } from './log';

export const TEMPLATES = [
  {
    title: 'TypeScript',
    value: 'typescript',
    description: 'a minimal module written in TypeScript',
  },

  {
    title: 'JavaScript',
    value: 'javascript',
    description: 'a minimal module written in JavaScript',
  },
];

export const ALIASES = TEMPLATES.map(({ value }) => value);

export async function promptTemplateAsync(): Promise<'typescript' | 'javascript'> {
  const { answer } = await prompts({
    type: 'select',
    name: 'answer',
    message: 'Choose a template:',
    choices: TEMPLATES,
  });

  if (!answer) {
    Log.log();
    Log.log(chalk`Please specify the template, example: {cyan --template typescript}`);
    Log.log();
    process.exit(1);
  }

  return answer;
}

/**
 * Extract a template app to a given file path and clean up any properties left over from npm to
 * prepare it for usage.
 */
export async function extractAndPrepareTemplateFunctionModuleAsync(
  projectRoot: string,
  resolvedTemplate: string
): Promise<string> {
  await copyTemplateAsync(resolvedTemplate, {
    cwd: projectRoot,
  });

  return projectRoot;
}

export async function copyTemplateAsync(
  resolvedTemplate: string,
  props: {
    cwd: string;
  }
): Promise<void> {
  const modulePath = path.resolve(__dirname, '../templates', resolvedTemplate);
  try {
    await copyDir(modulePath, props.cwd);
  } catch (error: any) {
    Log.error('Error extracting template package: ' + resolvedTemplate);
    throw error;
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  try {
    await fs.copy(src, dest);
  } catch (error: any) {
    Log.error(error);
    throw error;
  }
}
