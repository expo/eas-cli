import chalk from 'chalk';
import glob from 'fast-glob';
import fs from 'fs-extra';
import path from 'path';
import { pipeline } from 'stream/promises';
import { extract } from 'tar';

import { printDirectory } from './utils';
import fetch from '../../fetch';
import { PackageManager, installDependenciesAsync } from '../../onboarding/installDependencies';
import { runCommandAsync } from '../../onboarding/runCommand';
import { ora } from '../../ora';
import { expoCommandAsync } from '../../utils/expoCli';

export const TEMPLATE_PACKAGE_NAME = 'expo-template-default';
const NPM_REGISTRY_URL =
  process.env.npm_config_registry?.replace(/\/$/, '') ?? 'https://registry.npmjs.org';

export interface TemplateInfo {
  npmTag: string;
  version: string;
  tarballUrl: string;
}

export interface TemplatePackument {
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, { dist: { tarball: string } }>;
}

export async function fetchTemplatePackumentAsync(): Promise<TemplatePackument> {
  const response = await fetch(`${NPM_REGISTRY_URL}/${TEMPLATE_PACKAGE_NAME}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(10000),
  });
  return (await response.json()) as TemplatePackument;
}

export async function downloadTemplateAsync(
  targetProjectDir: string,
  template: TemplateInfo
): Promise<string> {
  const spinner = ora(
    `${chalk.bold(`Downloading the project template to ${printDirectory(targetProjectDir)}`)}`
  ).start();

  const targetExisted = await fs.pathExists(targetProjectDir);
  try {
    // The directory was verified to not exist earlier, but it may have been
    // created while the user was answering prompts.
    if (targetExisted && (await fs.readdir(targetProjectDir)).length > 0) {
      throw new Error(
        `Directory ${printDirectory(targetProjectDir)} already exists and is not empty.`
      );
    }

    await fs.mkdirp(targetProjectDir);
    const tarballResponse = await fetch(template.tarballUrl);
    await pipeline(tarballResponse.body, extract({ cwd: targetProjectDir, strip: 1 }));

    await restoreTemplateDotfilesAsync(targetProjectDir);

    spinner.succeed(
      `Downloaded ${chalk.bold(`${TEMPLATE_PACKAGE_NAME}@${template.version}`)} to ${printDirectory(
        targetProjectDir
      )}`
    );
  } catch (error) {
    spinner.fail();
    // Clean up a partially extracted project, but never a directory that
    // already existed before the download started.
    if (!targetExisted) {
      await fs.remove(targetProjectDir);
    }
    throw error;
  }

  return targetProjectDir;
}

/**
 * npm strips `.gitignore` files from published packages, and the template ships
 * dot-directories with an underscore prefix (e.g. `_vscode`), so restore the
 * real names after extraction. This mirrors the renames in create-expo-app;
 * keep the directory list in sync with SUPPORTED_DIRECTORIES in
 * https://github.com/expo/expo/blob/main/packages/create-expo-app/src/createFileTransform.ts
 */
async function restoreTemplateDotfilesAsync(projectDir: string): Promise<void> {
  const entries = await glob('**/{gitignore,_eas,_vscode,_github,_cursor}', {
    cwd: projectDir,
    onlyFiles: false,
    dot: true,
  });

  // Rename deeper entries first so parent renames do not invalidate child paths.
  entries.sort((a, b) => b.split('/').length - a.split('/').length);

  for (const entry of entries) {
    const basename = path.basename(entry);
    const dotName = basename === 'gitignore' ? '.gitignore' : `.${basename.slice(1)}`;
    await fs.move(
      path.join(projectDir, entry),
      path.join(projectDir, path.dirname(entry), dotName),
      { overwrite: true }
    );
  }
}

export async function installProjectDependenciesAsync(
  projectDir: string,
  packageManager: PackageManager
): Promise<void> {
  const spinner = ora(`${chalk.bold('Installing project dependencies')}`).start();
  await installDependenciesAsync({
    outputLevel: 'none',
    projectDir,
    packageManager,
  });

  const dependencies = ['expo-updates', '@expo/metro-runtime'];
  spinner.text = `Installing ${dependencies.map(dep => chalk.bold(dep)).join(', ')}`;
  await expoCommandAsync(projectDir, ['install', ...dependencies], { silent: true });
  spinner.succeed(`Installed project dependencies`);
}

export async function initializeGitRepositoryAsync(projectDir: string): Promise<void> {
  const spinner = ora(`${chalk.bold('Initializing Git repository')}`).start();
  await fs.remove(path.join(projectDir, '.git'));

  const commands = [['init'], ['add', '.'], ['commit', '-m', 'Initial commit']];

  for (const args of commands) {
    await runCommandAsync({
      cwd: projectDir,
      command: 'git',
      args,
      showOutput: false,
      showSpinner: false,
    });
  }
  spinner.succeed(`Initialized Git repository`);
}
