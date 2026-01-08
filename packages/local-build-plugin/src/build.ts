import path from 'path';

import { BuildJob, Platform, ArchiveSourceType, Metadata, Workflow } from '@expo/eas-build-job';
import pickBy from 'lodash/pickBy';
import fs from 'fs-extra';
import chalk from 'chalk';
import { Artifacts, SkipNativeBuildError } from '@expo/build-tools';
import { DEBUG } from 'bunyan';

import { buildAndroidAsync } from './android';
import config from './config';
import { buildIosAsync } from './ios';
import { prepareWorkingdirAsync } from './workingdir';
import { createLogger } from './logger';

export async function buildAsync(job: BuildJob, metadata: Metadata): Promise<void> {
  const logger = createLogger(job.loggerLevel);
  const workingdir = await prepareWorkingdirAsync({ logger });

  try {
    let username = metadata.username;
    if (!username && job.type === Workflow.MANAGED) {
      username = job.username;
    }

    // keep in sync with worker env vars
    // https://github.com/expo/turtle-v2/blob/main/src/services/worker/src/env.ts
    const unfilteredEnv: Record<string, string | undefined> = {
      ...process.env,
      ...job.builderEnvironment?.env,
      // We don't use Node.js mirror locally, but a user might
      NVM_NODEJS_ORG_MIRROR: process.env.NVM_NODEJS_ORG_MIRROR,
      EAS_BUILD: '1',
      EAS_BUILD_RUNNER: 'local-build-plugin',
      EAS_BUILD_PLATFORM: job.platform,
      EAS_BUILD_WORKINGDIR: path.join(workingdir, 'build'),
      EAS_BUILD_PROFILE: metadata.buildProfile,
      EAS_BUILD_GIT_COMMIT_HASH: metadata.gitCommitHash,
      EAS_BUILD_USERNAME: username,
      ...(job.platform === Platform.ANDROID && {
        EAS_BUILD_ANDROID_VERSION_CODE: job.version?.versionCode,
        EAS_BUILD_ANDROID_VERSION_NAME: job.version?.versionName,
      }),
      ...(job.platform === Platform.IOS && {
        EAS_BUILD_IOS_BUILD_NUMBER: job.version?.buildNumber,
        EAS_BUILD_IOS_APP_VERSION: job.version?.appVersion,
      }),
    };
    const env = pickBy(unfilteredEnv, (val?: string): val is string => !!val);

    let artifacts: Artifacts | undefined;
    switch (job.platform) {
      case Platform.ANDROID: {
        artifacts = await buildAndroidAsync(job, { env, workingdir, metadata, logger });
        break;
      }
      case Platform.IOS: {
        artifacts = await buildIosAsync(job, { env, workingdir, metadata, logger });
        break;
      }
    }
    if (!config.skipNativeBuild) {
      console.log();
      console.log(chalk.green('Build successful'));
      if (artifacts.APPLICATION_ARCHIVE) {
        console.log(
          chalk.green(`You can find the build artifacts in ${artifacts.APPLICATION_ARCHIVE}`)
        );
      }
    }
  } catch (e: any) {
    if (e instanceof SkipNativeBuildError) {
      console.log(e.message);
      return;
    }
    console.error();
    console.error(chalk.red(`Build failed`));
    if (logger.level() === DEBUG) {
      console.error(e.innerError);
    }
    throw e;
  } finally {
    if (!config.skipCleanup) {
      await fs.remove(workingdir);
    } else {
      console.error(chalk.yellow(`Skipping cleanup, ${workingdir} won't be removed.`));
    }
    if (job.projectArchive.type === ArchiveSourceType.PATH) {
      await fs.remove(job.projectArchive.path);
    }
  }
}
