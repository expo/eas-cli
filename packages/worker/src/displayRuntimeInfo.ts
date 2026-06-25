import { BuildContext } from '@expo/build-tools';
import { EnvironmentSecretType, Job } from '@expo/eas-build-job';
import formatBytes from 'filesize';
import fs from 'fs-extra';
import os from 'os';

import config from './config';
import { Environment } from './constants';

export function displayWorkerRuntimeInfo(ctx: BuildContext<Job>): void {
  printVMSpecs(ctx);
  printImageDescription(ctx);
  printImageMessage(ctx);
  printEnvs(ctx);
}

function printVMSpecs(ctx: BuildContext<Job>): void {
  const specs = [
    getCpuModelDescription(),
    `${os.cpus().length} vCPUs`,
    `${formatBytes(os.totalmem())} RAM`,
  ].flatMap(spec => spec || []);

  ctx.logger.info(specs.join(', '));
  ctx.logger.info('');
}

function getCpuModelDescription(): string | null {
  const cpuModel = os.cpus()[0]?.model.trim().replaceAll(/\s+/g, ' ').replace(' (Virtual)', '');
  if (!cpuModel) {
    return null;
  }

  if (cpuModel.toLowerCase().includes('intel')) {
    return 'Intel';
  } else if (cpuModel.toLowerCase().includes('amd')) {
    return 'AMD';
  }

  return cpuModel;
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
      if (value !== undefined) {
        instanceEnv[key] = value;
      }
    });
  }
  Object.entries(job.builderEnvironment?.env ?? {}).forEach(([key, value]) => {
    if (value !== undefined) {
      publicEnv[key] = value;
      delete instanceEnv[key];
    }
  });

  job.secrets?.environmentSecrets?.forEach(({ name, type }) => {
    if (type === EnvironmentSecretType.FILE) {
      // File secrets are displayed as the generated file path, which only exists after materialization.
      if (ctx.env[name] !== undefined) {
        secretEnv[name] = ctx.env[name];
      }
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
