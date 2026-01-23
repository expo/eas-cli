import path from 'path';

import fs from 'fs-extra';
import { BuildFunction } from '@expo/steps';

import { findPackagerRootDir } from '../../utils/packageManager';
import { NpmrcTemplate } from '../../templates/npmrc';

export function createSetUpNpmrcBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'use_npm_token',
    name: 'Use NPM_TOKEN',
    __metricsId: 'eas/use_npm_token',
    fn: async (stepCtx, { env }) => {
      const { logger } = stepCtx;
      if (env.NPM_TOKEN) {
        logger.info('We detected that you set the NPM_TOKEN environment variable');
        const projectNpmrcPath = path.join(stepCtx.global.projectTargetDirectory, '.npmrc');
        if (await fs.pathExists(projectNpmrcPath)) {
          logger.info('.npmrc already exists in your project directory, skipping generation');
        } else {
          logger.info('Creating .npmrc in your project directory with the following contents:');
          logger.info(NpmrcTemplate);
          await fs.writeFile(projectNpmrcPath, NpmrcTemplate);
        }
      } else {
        const projectNpmrcPath = path.join(findPackagerRootDir(stepCtx.workingDirectory), '.npmrc');
        if (await fs.pathExists(projectNpmrcPath)) {
          logger.info(
            `.npmrc found at ${path.relative(
              stepCtx.global.projectTargetDirectory,
              projectNpmrcPath
            )}`
          );
        }
      }
    },
  });
}
