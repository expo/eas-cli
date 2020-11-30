import { getConfig } from '@expo/config';
import { EasJsonReader } from '@expo/eas-json';
import fs from 'fs-extra';
import path from 'path';

import log from '../log';
import { ensureLoggedInAsync } from '../user/actions';
import { gitAddAsync } from '../utils/git';
import { configureAndroidAsync } from './android/configure';
import { ConfigureContext } from './context';
import { configureIosAsync } from './ios/configure';
import { BuildCommandPlatform } from './types';
import {
  ensureGitRepoExistsAsync,
  isGitStatusCleanAsync,
  maybeBailOnGitStatusAsync,
  reviewAndCommitChangesAsync,
} from './utils/repository';

export async function configureAsync(options: {
  platform: BuildCommandPlatform;
  projectDir: string;
}): Promise<void> {
  await ensureGitRepoExistsAsync();
  await maybeBailOnGitStatusAsync();

  const { exp } = getConfig(options.projectDir, { skipSDKVersionRequirement: true });

  const ctx: ConfigureContext = {
    user: await ensureLoggedInAsync(),
    projectDir: options.projectDir,
    exp,
    requestedPlatform: options.platform,
    shouldConfigureAndroid: [BuildCommandPlatform.ALL, BuildCommandPlatform.ANDROID].includes(
      options.platform
    ),
    shouldConfigureIos: [BuildCommandPlatform.ALL, BuildCommandPlatform.IOS].includes(
      options.platform
    ),
    hasAndroidNativeProject: await fs.pathExists(path.join(options.projectDir, 'android')),
    hasIosNativeProject: await fs.pathExists(path.join(options.projectDir, 'ios')),
  };

  await ensureEasJsonExistsAsync(ctx);
  if (ctx.shouldConfigureAndroid) {
    await configureAndroidAsync(ctx);
  }
  if (ctx.shouldConfigureIos) {
    await configureIosAsync(ctx);
  }

  if (!(await isGitStatusCleanAsync())) {
    log.newLine();
    try {
      await reviewAndCommitChangesAsync('Configure EAS Build', {
        nonInteractive: false,
      });
    } catch (e) {
      throw new Error(
        "Aborting, run the command again once you're ready. Make sure to commit any changes you've made."
      );
    }
  }
}

export async function ensureEasJsonExistsAsync(ctx: ConfigureContext): Promise<void> {
  const easJsonPath = path.join(ctx.projectDir, 'eas.json');
  if (await fs.pathExists(easJsonPath)) {
    await new EasJsonReader(ctx.projectDir, ctx.requestedPlatform).validateAsync();
    log.withTick('eas.json validated successfully');
    return;
  }

  const easJson = {
    builds: {
      android: {
        release: {
          workflow: ctx.hasAndroidNativeProject ? 'generic' : 'managed',
        },
      },
      ios: {
        release: {
          workflow: ctx.hasIosNativeProject ? 'generic' : 'managed',
        },
      },
    },
  };

  await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  await gitAddAsync(easJsonPath, { intentToAdd: true });
  log.withTick('Created eas.json file');
}
