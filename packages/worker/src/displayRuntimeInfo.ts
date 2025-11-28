import fs from 'fs-extra';
import { EnvironmentSecretType, Job } from '@expo/eas-build-job';
import { BuildContext } from '@expo/build-tools';
import { ResourceClass } from '@expo/turtle-common';

import config, { Environment } from './config';

const RESOURCE_CLASS_DESCRIPTION: Record<ResourceClass, string> = {
  [ResourceClass.ANDROID_N2_1_3_12]: 'Intel, 4 vCPUs, 16 GB RAM',
  [ResourceClass.ANDROID_N2_2_6_24]: 'Intel, 8 vCPUs, 32 GB RAM',
  [ResourceClass.IOS_M1_4_16]: 'M1, 2 cores, 8 GB RAM',
  [ResourceClass.IOS_M2_2_8]: 'M2, 2 cores, 8 GB RAM',
  [ResourceClass.IOS_M2_PRO_4_12]: 'M2 Pro, 4 cores, 12 GB RAM',
  [ResourceClass.IOS_M4_PRO_5_20]: 'M4 Pro, 5 cores, 20 GB RAM',
  [ResourceClass.IOS_M4_PRO_10_40]: 'M4 Pro, 10 cores, 40 GB RAM',
  [ResourceClass.IOS_M2_4_22]: 'M2, 4 cores, 22 GB RAM',
  [ResourceClass.LINUX_C3D_STANDARD_4]: 'AMD, 4 vCPUs, 16 GB RAM',
  [ResourceClass.LINUX_C3D_STANDARD_8]: 'AMD, 8 vCPUs, 32 GB RAM',
  [ResourceClass.LINUX_C4D_STANDARD_4]: 'AMD, 4 vCPUs, 15 GB RAM',
  [ResourceClass.LINUX_C4D_STANDARD_8]: 'AMD, 8 vCPUs, 31 GB RAM',
};

export function displayWorkerRuntimeInfo(ctx: BuildContext<Job>): void {
  printVMSpecs(ctx);
  printImageDescription(ctx);
  printImageMessage(ctx);
  printEnvs(ctx);
}

function printVMSpecs(ctx: BuildContext<Job>): void {
  const { resourceClass } = config;

  if (resourceClass) {
    const resourceClassDescription = RESOURCE_CLASS_DESCRIPTION[resourceClass];

    if (resourceClassDescription) {
      ctx.logger.info(resourceClassDescription);
    } else {
      ctx.logger.debug(
        `Resource class is unsupported: ${resourceClass}, valid values: ${Object.keys(
          RESOURCE_CLASS_DESCRIPTION
        )}}`
      );
    }
    ctx.logger.info('');
  }
}

function printImageMessage(ctx: BuildContext<Job>): void {
  const imageMessage = ctx.metadata?.trackingContext?.imageMessage;
  if (imageMessage) {
    ctx.logger.info(imageMessage);
  }
}

function printImageDescription(ctx: BuildContext<Job>): void {
  const workerDescriptionPath = config.workerDescriptionPath;
  if (!fs.existsSync(workerDescriptionPath)) {
    return;
  }

  const { logger } = ctx;
  let description = fs.readFileSync(workerDescriptionPath, 'utf8');
  description = description.replaceAll(
    'macos-sequoia-15.6.1-xcode-26.1',
    'macos-sequoia-15.6-xcode-26.1'
  );
  description
    .trim()
    .split('\n')
    .forEach(line => {
      logger.info(line);
    });
}

function printEnvs(ctx: BuildContext<Job>): void {
  const { logger, job } = ctx;
  const publicEnv: Record<string, string> = {};
  const secretEnv: Record<string, string> = {};
  const instanceEnv: Record<string, string> = {};

  // skip development and testing to avoid leaking local credentials from envs to bucket
  if (config.env !== Environment.DEVELOPMENT && config.env !== Environment.TEST) {
    Object.entries(ctx.env).forEach(([key, value]) => {
      instanceEnv[key] = value;
    });
  }
  Object.entries(job.builderEnvironment?.env ?? ({} as Record<string, string>)).forEach(
    ([key, value]) => {
      publicEnv[key] = value;
      delete instanceEnv[key];
    }
  );

  job.secrets?.environmentSecrets?.forEach(({ name, type }) => {
    if (type === EnvironmentSecretType.FILE) {
      secretEnv[name] = ctx.env[name];
    } else {
      secretEnv[name] = '********';
    }
    delete publicEnv[name];
    delete instanceEnv[name];
  });

  const hasPublicEnv = Object.keys(publicEnv).length > 0;
  const hasSecretEnv = Object.keys(secretEnv).length > 0;
  const hasInstanceEnv = Object.keys(instanceEnv).length > 0;

  if (hasPublicEnv) {
    logger.info('');
    logger.info('Project environment variables:');
    Object.entries(publicEnv).forEach(([key, value]) => {
      logger.info(`  ${key}=${value}`);
    });
  }
  if (hasSecretEnv) {
    logger.info('');
    logger.info('Environment secrets:');
    Object.entries(secretEnv).forEach(([key, value]) => {
      logger.info(`  ${key}=${value}`);
    });
  }
  if (hasInstanceEnv) {
    logger.info('');
    logger.info('EAS Build environment variables:');
    Object.entries(instanceEnv).forEach(([key, value]) => {
      logger.info(`  ${key}=${value}`);
    });
  }
  logger.info('');
}
