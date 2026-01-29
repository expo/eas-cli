#!/usr/bin/env node

import path from 'path';
import fs from 'fs';

import chalk from 'chalk';

import { extractAndPrepareTemplateFunctionModuleAsync, promptTemplateAsync } from './templates';
import { assertFolderEmpty, assertValidName, resolveProjectRootAsync } from './resolveProjectRoot';
import {
  PackageManagerName,
  installDependenciesAsync,
  resolvePackageManager,
} from './resolvePackageManager';
import { Log } from './log';
import { withSectionLog } from './utils/log';

export type Options = {
  install: boolean;
  template?: string | true;
};

export async function createAsync(inputPath: string, options: Options): Promise<void> {
  let resolvedTemplate: string;
  if (options.template === true) {
    resolvedTemplate = await promptTemplateAsync();
  } else {
    resolvedTemplate = options.template ?? 'typescript';
  }

  const projectRoot = await resolveProjectRootArgAsync(inputPath);
  await fs.promises.mkdir(projectRoot, { recursive: true });

  await withSectionLog(
    () => extractAndPrepareTemplateFunctionModuleAsync(projectRoot, resolvedTemplate),
    {
      pending: chalk.bold('Locating project files...'),
      success: 'Successfully extracted custom build function template files.',
      error: (error) =>
        `Something went wrong when extracting the custom build function template files: ${error.message}`,
    }
  );

  await setupDependenciesAsync(projectRoot, options);
}

async function resolveProjectRootArgAsync(inputPath: string): Promise<string> {
  if (!inputPath) {
    const projectRoot = path.resolve(process.cwd());
    const folderName = path.basename(projectRoot);
    assertValidName(folderName);
    assertFolderEmpty(projectRoot, folderName);
    return projectRoot;
  } else {
    return await resolveProjectRootAsync(inputPath);
  }
}

async function setupDependenciesAsync(
  projectRoot: string,
  props: Pick<Options, 'install'>
): Promise<void> {
  // Install dependencies
  const shouldInstall = props.install;
  const packageManager = resolvePackageManager();
  if (shouldInstall) {
    await installNodeDependenciesAsync(projectRoot, packageManager);
  }
  const cdPath = getChangeDirectoryPath(projectRoot);
  Log.log();
  logProjectReady({ cdPath });
  if (!shouldInstall) {
    logNodeInstallWarning(cdPath, packageManager);
  }
}

async function installNodeDependenciesAsync(
  projectRoot: string,
  packageManager: PackageManagerName
): Promise<void> {
  try {
    await installDependenciesAsync(projectRoot, packageManager, { silent: false });
  } catch (error: any) {
    Log.error(
      `Something went wrong installing JavaScript dependencies. Check your ${packageManager} logs. Continuing to create the app.`
    );
    Log.exception(error);
  }
}

function getChangeDirectoryPath(projectRoot: string): string {
  const cdPath = path.relative(process.cwd(), projectRoot);
  if (cdPath.length <= projectRoot.length) {
    return cdPath;
  }
  return projectRoot;
}

function logNodeInstallWarning(cdPath: string, packageManager: PackageManagerName): void {
  Log.log(
    `\n⚠️  Before you start to work on your function, make sure you have modules installed:\n`
  );
  Log.log(`  cd ${cdPath || '.'}${path.sep}`);
  Log.log(`  ${packageManager} install`);
  Log.log();
}

export function logProjectReady({ cdPath }: { cdPath: string }): void {
  Log.log(chalk.bold(`✅ Your function is ready!`));
  Log.log();

  // empty string if project was created in current directory
  if (cdPath) {
    Log.log(`To start working on your function, navigate to the directory.`);
    Log.log();
    Log.log(`- ${chalk.bold('cd ' + cdPath)}`);
  }
}
