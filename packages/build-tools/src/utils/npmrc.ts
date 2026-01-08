import path from 'path';

import { Job } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';

import { BuildContext } from '../context';
import { NpmrcTemplate } from '../templates/npmrc';

import { findPackagerRootDir } from './packageManager';

export async function setUpNpmrcAsync(ctx: BuildContext<Job>, logger: bunyan): Promise<void> {
  if (ctx.env.NPM_TOKEN) {
    await createNpmrcIfNotExistsAsync(ctx, logger);
  } else {
    await logIfNpmrcExistsAsync(ctx, logger);
  }
}

async function createNpmrcIfNotExistsAsync(ctx: BuildContext<Job>, logger: bunyan): Promise<void> {
  logger.info('We detected that you set the NPM_TOKEN environment variable');
  const projectNpmrcPath = path.join(ctx.buildDirectory, '.npmrc');
  if (await fs.pathExists(projectNpmrcPath)) {
    logger.info('.npmrc already exists in your project directory, skipping generation');
  } else {
    logger.info('Creating .npmrc in your project directory with the following contents:');
    logger.info(NpmrcTemplate);
    await fs.writeFile(projectNpmrcPath, NpmrcTemplate);
  }
}

async function logIfNpmrcExistsAsync(ctx: BuildContext<Job>, logger: bunyan): Promise<void> {
  const projectNpmrcPath = path.join(
    findPackagerRootDir(ctx.getReactNativeProjectDirectory()),
    '.npmrc'
  );
  if (await fs.pathExists(projectNpmrcPath)) {
    logger.info(`.npmrc found at ${path.relative(ctx.buildDirectory, projectNpmrcPath)}`);
  }
}
