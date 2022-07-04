import { Platform, Workflow } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { cleanUpOldEasBuildGradleScriptAsync } from '../../build/android/syncProjectConfiguration.js';
import { ensureProjectConfiguredAsync } from '../../build/configure.js';
import EasCommand from '../../commandUtils/EasCommand.js';
import Log, { learnMore } from '../../log.js';
import { RequestedPlatform } from '../../platform.js';
import { getExpoConfig } from '../../project/expoConfig.js';
import { findProjectRootAsync, isExpoUpdatesInstalled } from '../../project/projectUtils.js';
import { resolveWorkflowAsync } from '../../project/workflow.js';
import { promptAsync } from '../../prompts.js';
import { syncUpdatesConfigurationAsync as syncAndroidUpdatesConfigurationAsync } from '../../update/android/UpdatesModule.js';
import { syncUpdatesConfigurationAsync as syncIosUpdatesConfigurationAsync } from '../../update/ios/UpdatesModule.js';
import { getVcsClient } from '../../vcs/index.js';

export default class BuildConfigure extends EasCommand {
  static description = 'configure the project to support EAS Build';

  static flags = {
    platform: Flags.enum({
      description: 'Platform to configure',
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildConfigure);

    Log.log(
      '💡 The following process will configure your iOS and/or Android project to be compatible with EAS Build. These changes only apply to your local project files and you can safely revert them at any time.'
    );

    await getVcsClient().ensureRepoExistsAsync();

    const projectDir = await findProjectRootAsync();
    const expoUpdatesIsInstalled = isExpoUpdatesInstalled(projectDir);

    const platform =
      (flags.platform as RequestedPlatform | undefined) ?? (await promptForPlatformAsync());

    // clean up old Android configuration
    if ([RequestedPlatform.Android, RequestedPlatform.All].includes(platform)) {
      await cleanUpOldEasBuildGradleScriptAsync(projectDir);
    }

    // ensure eas.json exists
    Log.newLine();
    await ensureProjectConfiguredAsync({
      projectDir,
      nonInteractive: false,
    });

    // configure expo-updates
    if (expoUpdatesIsInstalled) {
      const exp = getExpoConfig(projectDir);

      if ([RequestedPlatform.Android, RequestedPlatform.All].includes(platform)) {
        const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
        if (workflow === Workflow.GENERIC) {
          await syncAndroidUpdatesConfigurationAsync(projectDir, exp);
        }
      }

      if ([RequestedPlatform.Ios, RequestedPlatform.All].includes(platform)) {
        const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS);
        if (workflow === Workflow.GENERIC) {
          await syncIosUpdatesConfigurationAsync(projectDir, exp);
        }
      }
    }

    Log.addNewLineIfNone();

    Log.log(`🎉 Your project is ready to build.

- Run ${chalk.bold('eas build')} when you are ready to create your first build.
- Once the build is completed, run ${chalk.bold('eas submit')} to upload the app to app stores.
- ${learnMore('https://docs.expo.dev/build/introduction', {
      learnMoreMessage: 'Learn more about other capabilities of EAS Build',
    })}`);
  }
}

async function promptForPlatformAsync(): Promise<RequestedPlatform> {
  Log.addNewLineIfNone();
  const { platform } = await promptAsync({
    type: 'select',
    message: 'Which platforms would you like to configure for EAS Build?',
    name: 'platform',
    choices: [
      {
        title: 'All',
        value: RequestedPlatform.All,
      },
      {
        title: 'iOS',
        value: RequestedPlatform.Ios,
      },
      {
        title: 'Android',
        value: RequestedPlatform.Android,
      },
    ],
  });
  return platform;
}
