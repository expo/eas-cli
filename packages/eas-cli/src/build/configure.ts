import { getConfig } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { EasJson, EasJsonReader } from '@expo/eas-json';
import { error } from '@oclif/errors';
import chalk from 'chalk';
import fs from 'fs-extra';

import Log, { learnMore } from '../log';
import { RequestedPlatform } from '../platform';
import { resolveWorkflowAsync } from '../project/workflow';
import { confirmAsync, promptAsync } from '../prompts';
import { ensureLoggedInAsync } from '../user/actions';
import { easCliVersion } from '../utils/easCli';
import { getVcsClient } from '../vcs';
import { configureAndroidAsync } from './android/configure';
import { ConfigureContext } from './context';
import { configureIosAsync } from './ios/configure';
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
  if (await fs.pathExists(EasJsonReader.formatEasJsonPath(projectDir))) {
    return;
  }

  const message = 'This project is not configured to build with EAS. Set it up now?';
  const confirm = await confirmAsync({ message });
  if (confirm) {
    await configureAsync({
      projectDir,
      platform: requestedPlatform,
    });
    if (await getVcsClient().isCommitRequiredAsync()) {
      error(
        'Build process requires clean working tree, please commit all your changes and run `eas build` again',
        { exit: 1 }
      );
    }
  } else {
    error(
      `Aborting, please run ${chalk.bold('eas build:configure')} or create eas.json (${learnMore(
        'https://docs.expo.dev/build/eas-json'
      )})`,
      { exit: 1 }
    );
  }
}

export async function configureAsync(options: {
  platform: RequestedPlatform;
  projectDir: string;
}): Promise<void> {
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

  if (await getVcsClient().isCommitRequiredAsync()) {
    Log.newLine();
    await reviewAndCommitChangesAsync(configureCommitMessage[options.platform]);
  } else if (!(await getVcsClient().hasUncommittedChangesAsync())) {
    Log.newLine();
    Log.withTick('No changes were necessary, the project is already configured correctly.');
  }
}

const EAS_JSON_MANAGED_DEFAULT: EasJson = {
  cli: {
    version: `>= ${easCliVersion}`,
  },
  build: {
    development: {
      developmentClient: true,
      distribution: 'internal',
    },
    preview: {
      distribution: 'internal',
    },
    production: {},
  },
  submit: {
    production: {},
  },
};

const EAS_JSON_BARE_DEFAULT: EasJson = {
  cli: {
    version: `>= ${easCliVersion}`,
  },
  build: {
    development: {
      distribution: 'internal',
      android: {
        gradleCommand: ':app:assembleDebug',
      },
      ios: {
        buildConfiguration: 'Debug',
      },
    },
    preview: {
      distribution: 'internal',
    },
    production: {},
  },
  submit: {
    production: {},
  },
};

export async function ensureEasJsonExistsAsync(ctx: ConfigureContext): Promise<void> {
  const easJsonPath = EasJsonReader.formatEasJsonPath(ctx.projectDir);

  if (await fs.pathExists(easJsonPath)) {
    const reader = new EasJsonReader(ctx.projectDir);
    await reader.readAsync();

    Log.withTick('Validated eas.json');
    return;
  }

  const easJson =
    ctx.hasAndroidNativeProject && ctx.hasIosNativeProject
      ? EAS_JSON_BARE_DEFAULT
      : EAS_JSON_MANAGED_DEFAULT;

  await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  await getVcsClient().trackFileAsync(easJsonPath);
  Log.withTick('Generated eas.json');
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
    await getVcsClient().showDiffAsync();
    await reviewAndCommitChangesAsync(initialCommitMessage, false);
  }
}
