import { getConfig } from '@expo/config';
import { EasJsonReader } from '@expo/eas-json';
import fs from 'fs-extra';
import path from 'path';

import log from '../log';
import { promptAsync } from '../prompts';
import { ensureLoggedInAsync } from '../user/actions';
import { gitAddAsync } from '../utils/git';
import { configureAndroidAsync } from './android/configure';
import { ConfigureContext } from './context';
import { configureIosAsync } from './ios/configure';
import { RequestedPlatform } from './types';
import {
  commitPromptAsync,
  ensureGitRepoExistsAsync,
  isGitStatusCleanAsync,
  maybeBailOnGitStatusAsync,
  showDiffAsync,
} from './utils/repository';

const configureCommitMessage = {
  [RequestedPlatform.Android]: 'Configure EAS Build for Android',
  [RequestedPlatform.iOS]: 'Configure EAS Build for iOS',
  [RequestedPlatform.All]: 'Configure EAS Build',
};

export async function configureAsync(options: {
  platform: RequestedPlatform;
  projectDir: string;
  allowExperimental: boolean;
}): Promise<void> {
  await ensureGitRepoExistsAsync();
  await maybeBailOnGitStatusAsync();

  const { exp } = getConfig(options.projectDir, { skipSDKVersionRequirement: true });

  const ctx: ConfigureContext = {
    user: await ensureLoggedInAsync(),
    projectDir: options.projectDir,
    exp,
    allowExperimental: options.allowExperimental,
    requestedPlatform: options.platform,
    shouldConfigureAndroid: [RequestedPlatform.All, RequestedPlatform.Android].includes(
      options.platform
    ),
    shouldConfigureIos: [RequestedPlatform.All, RequestedPlatform.iOS].includes(options.platform),
    hasAndroidNativeProject: await fs.pathExists(path.join(options.projectDir, 'android')),
    hasIosNativeProject: await fs.pathExists(path.join(options.projectDir, 'ios')),
  };

  log.newLine();
  await ensureEasJsonExistsAsync(ctx);
  if (ctx.shouldConfigureAndroid) {
    await configureAndroidAsync(ctx);
  }
  if (ctx.shouldConfigureIos) {
    await configureIosAsync(ctx);
  }

  if (!(await isGitStatusCleanAsync())) {
    log.newLine();
    await reviewAndCommitChangesAsync(configureCommitMessage[options.platform]);
  } else {
    log.newLine();
    log.withTick('No changes were necessary, the project is already configured correctly.');
  }
}

export async function ensureEasJsonExistsAsync(ctx: ConfigureContext): Promise<void> {
  const easJsonPath = path.join(ctx.projectDir, 'eas.json');
  if (await fs.pathExists(easJsonPath)) {
    await new EasJsonReader(ctx.projectDir, ctx.requestedPlatform).validateAsync();
    log.withTick('Validated eas.json.');
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
  log.withTick('Generated eas.json.');
}

enum ShouldCommitChanges {
  Yes,
  ShowDiffFirst,
  Skip,
}

async function reviewAndCommitChangesAsync(
  commitMessage: string,
  askedFirstTime: boolean = true
): Promise<void> {
  const { selected } = await promptAsync({
    type: 'select',
    name: 'selected',
    message: 'Can we commit these changes to git for you?',
    choices: [
      { title: 'Yes', value: ShouldCommitChanges.Yes },
      ...(askedFirstTime
        ? [{ title: 'Show the diff and ask me again', value: ShouldCommitChanges.ShowDiffFirst }]
        : []),
      {
        title: 'Skip committing changes, I will do it later on my own',
        value: ShouldCommitChanges.Skip,
      },
    ],
  });

  if (selected === ShouldCommitChanges.Yes) {
    await commitPromptAsync(commitMessage);
    log.withTick('Committed changes.');
  } else if (selected === ShouldCommitChanges.ShowDiffFirst) {
    await showDiffAsync();
    await reviewAndCommitChangesAsync(commitMessage, false);
  }
}
