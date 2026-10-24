import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { findPackagerRootDir } from './packageManager';
import { NpmrcAuthTokenLine, NpmrcTemplate } from '../templates/npmrc';

export async function setUpNpmrcAsync({
  projectTargetDirectory,
  workingDirectory,
  env,
  logger,
}: {
  projectTargetDirectory: string;
  workingDirectory: string;
  env: Record<string, string | undefined>;
  logger: bunyan;
}): Promise<void> {
  if (!env.NPM_TOKEN) {
    await logIfNpmrcExistsAsync(projectTargetDirectory, workingDirectory, logger);
    return;
  }
  logger.info('We detected that you set the NPM_TOKEN environment variable');
  // pnpm 10.34.2+ and 11.5.3+ ignore ${NPM_TOKEN} placeholders in a project-level .npmrc but expand them in ~/.npmrc
  if (env.EAS_BUILD_RUNNER === 'eas-build') {
    await addNpmTokenToHomeNpmrcAsync(logger);
  } else {
    await createProjectNpmrcIfNotExistsAsync(projectTargetDirectory, logger);
  }
}

async function addNpmTokenToHomeNpmrcAsync(logger: bunyan): Promise<void> {
  logger.info(`Adding "${NpmrcAuthTokenLine}" to ~/.npmrc`);
  await fs.appendFile(path.join(os.homedir(), '.npmrc'), `\n${NpmrcAuthTokenLine}\n`);
}

async function createProjectNpmrcIfNotExistsAsync(
  projectTargetDirectory: string,
  logger: bunyan
): Promise<void> {
  const projectNpmrcPath = path.join(projectTargetDirectory, '.npmrc');
  if (await fs.pathExists(projectNpmrcPath)) {
    logger.info('.npmrc already exists in your project directory, skipping generation');
  } else {
    logger.info('Creating .npmrc in your project directory with the following contents:');
    logger.info(NpmrcTemplate);
    await fs.writeFile(projectNpmrcPath, NpmrcTemplate);
  }
}

async function logIfNpmrcExistsAsync(
  projectTargetDirectory: string,
  workingDirectory: string,
  logger: bunyan
): Promise<void> {
  const projectNpmrcPath = path.join(findPackagerRootDir(workingDirectory), '.npmrc');
  if (await fs.pathExists(projectNpmrcPath)) {
    logger.info(`.npmrc found at ${path.relative(projectTargetDirectory, projectNpmrcPath)}`);
  }
}
