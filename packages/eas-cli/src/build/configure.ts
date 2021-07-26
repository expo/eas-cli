import { getConfig } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { EasJsonReader } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';

import { ExitError } from '../error/ExitError';
import Log, { learnMore } from '../log';
import { resolveWorkflowAsync } from '../project/workflow';
import { confirmAsync, promptAsync } from '../prompts';
import { ensureLoggedInAsync } from '../user/actions';
import vcs from '../vcs';
import { configureAndroidAsync } from './android/configure';
import { ConfigureContext } from './context';
import { configureIosAsync } from './ios/configure';
import { RequestedPlatform } from './types';
import { commitPromptAsync, maybeBailOnRepoStatusAsync } from './utils/repository';

const configureCommitMessage = {
  [RequestedPlatform.Android]: 'Configure EAS Build for Android',
  [RequestedPlatform.Ios]: 'Configure EAS Build for iOS',
  [RequestedPlatform.All]: 'Configure EAS Build',
};

export async function ensureProjectConfiguredAsync(
  projectDir: string,
  requestedPlatform: RequestedPlatform
): Promise<void> {
  const platformToConfigure = await getPlatformToConfigureAsync(projectDir, requestedPlatform);
  if (!platformToConfigure) {
    return;
  }

  // Ensure the prompt is consistent with the platforms we need to configure
  let message = 'This project is not configured to build with EAS. Set it up now?';
  if (platformToConfigure === RequestedPlatform.Ios) {
    message = 'Your iOS project is not configured to build with EAS. Set it up now?';
  } else if (platformToConfigure === RequestedPlatform.Android) {
    message = 'Your Android project is not configured to build with EAS. Set it up now?';
  }

  const confirm = await confirmAsync({ message });
  if (confirm) {
    await configureAsync({
      projectDir,
      platform: platformToConfigure,
    });
    if (await vcs.hasUncommittedChangesAsync()) {
      throw new ExitError(
        'Build process requires clean working tree, please commit all your changes and run `eas build` again'
      );
    }
  } else {
    throw new ExitError(
      `Aborting, please run ${chalk.bold('eas build:configure')} or create eas.json (${learnMore(
        'https://docs.expo.io/build/eas-json'
      )})`
    );
  }
}

export async function configureAsync(options: {
  platform: RequestedPlatform;
  projectDir: string;
}): Promise<void> {
  await vcs.ensureRepoExistsAsync();
  await maybeBailOnRepoStatusAsync();

  const { exp } = getConfig(options.projectDir, { skipSDKVersionRequirement: true });

  const ctx: ConfigureContext = {
    user: await ensureLoggedInAsync(),
    projectDir: options.projectDir,
    exp,
    requestedPlatform: options.platform,
    shouldConfigureAndroid: [RequestedPlatform.All, RequestedPlatform.Android].includes(
      options.platform
    ),
    shouldConfigureIos: [RequestedPlatform.All, RequestedPlatform.Ios].includes(options.platform),
    hasAndroidNativeProject:
      (await resolveWorkflowAsync(options.projectDir, Platform.ANDROID)) === Workflow.GENERIC,
    hasIosNativeProject:
      (await resolveWorkflowAsync(options.projectDir, Platform.IOS)) === Workflow.GENERIC,
  };

  Log.newLine();
  await ensureEasJsonExistsAsync(ctx);
  if (ctx.shouldConfigureAndroid) {
    await configureAndroidAsync(ctx);
  }
  if (ctx.shouldConfigureIos) {
    await configureIosAsync(ctx);
  }

  if (await vcs.hasUncommittedChangesAsync()) {
    Log.newLine();
    await reviewAndCommitChangesAsync(configureCommitMessage[options.platform]);
  } else {
    Log.newLine();
    Log.withTick('No changes were necessary, the project is already configured correctly.');
  }
}

const ANDROID_MANAGED_DEFAULTS = {
  release: {
    buildType: 'app-bundle',
  },
  development: {
    buildType: 'development-client',
    distribution: 'internal',
  },
};
const ANDROID_GENERIC_DEFAULTS = {
  release: {
    gradleCommand: ':app:bundleRelease',
  },
  development: {
    gradleCommand: ':app:assembleDebug',
    distribution: 'internal',
  },
};

const IOS_MANAGED_DEFAULTS = {
  release: {
    buildType: 'release',
  },
  development: {
    buildType: 'development-client',
    distribution: 'internal',
  },
};

const IOS_GENERIC_DEFAULTS = {
  release: {
    schemeBuildConfiguration: 'Release',
  },
  development: {
    schemeBuildConfiguration: 'Debug',
    distribution: 'internal',
  },
};

export async function ensureEasJsonExistsAsync(ctx: ConfigureContext): Promise<void> {
  const easJsonPath = EasJsonReader.formatEasJsonPath(ctx.projectDir);
  let existingEasJson;

  if (await fs.pathExists(easJsonPath)) {
    const reader = new EasJsonReader(ctx.projectDir, ctx.requestedPlatform);
    await reader.validateAsync();

    existingEasJson = await reader.readRawAsync();
    Log.withTick('Validated eas.json');

    // If we have already populated eas.json with the default fields for the
    // platform then proceed
    if (ctx.requestedPlatform !== 'all' && existingEasJson.builds[ctx.requestedPlatform]) {
      return;
    } else if (
      ctx.requestedPlatform === 'all' &&
      existingEasJson.builds.ios &&
      existingEasJson.builds.android
    ) {
      return;
    }
  }

  const shouldInitIOS =
    ['all', 'ios'].includes(ctx.requestedPlatform) && !existingEasJson?.builds.ios;
  const shouldInitAndroid =
    ['all', 'android'].includes(ctx.requestedPlatform) && !existingEasJson?.builds.android;

  const easJson = {
    builds: {
      ...existingEasJson?.builds,
      ...(shouldInitAndroid
        ? {
            android: ctx.hasAndroidNativeProject
              ? ANDROID_GENERIC_DEFAULTS
              : ANDROID_MANAGED_DEFAULTS,
          }
        : null),
      ...(shouldInitIOS
        ? {
            ios: ctx.hasIosNativeProject ? IOS_GENERIC_DEFAULTS : IOS_MANAGED_DEFAULTS,
          }
        : null),
    },
  };

  await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  await vcs.trackFileAsync(easJsonPath);
  Log.withTick(`${existingEasJson ? 'Updated' : 'Generated'} eas.json`);
}

enum ShouldCommitChanges {
  Yes,
  ShowDiffFirst,
  Skip,
}

async function reviewAndCommitChangesAsync(
  initialCommitMessage: string,
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
    await commitPromptAsync({ initialCommitMessage });
    Log.withTick('Committed changes');
  } else if (selected === ShouldCommitChanges.ShowDiffFirst) {
    await vcs.showDiffAsync();
    await reviewAndCommitChangesAsync(initialCommitMessage, false);
  }
}

async function getPlatformToConfigureAsync(
  projectDir: string,
  platform: RequestedPlatform
): Promise<RequestedPlatform | null> {
  if (!(await fs.pathExists(EasJsonReader.formatEasJsonPath(projectDir)))) {
    return platform;
  }

  const easConfig = await new EasJsonReader(projectDir, platform).readRawAsync();
  if (platform === RequestedPlatform.All) {
    if (easConfig.builds?.android && easConfig.builds?.ios) {
      return null;
    } else if (easConfig.builds?.ios) {
      return RequestedPlatform.Android;
    } else if (easConfig.builds?.android) {
      return RequestedPlatform.Ios;
    }
  } else if (
    (platform === RequestedPlatform.Android || platform === RequestedPlatform.Ios) &&
    easConfig.builds?.[platform]
  ) {
    return null;
  }

  return platform;
}
