import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import { syncUpdatesConfigurationAsync as syncAndroidUpdatesConfigurationAsync } from '../../build/android/UpdatesModule';
import { ensureProjectConfiguredAsync } from '../../build/configure';
import { syncUpdatesConfigurationAsync as syncIosUpdatesConfigurationAsync } from '../../build/ios/UpdatesModule';
import { isExpoUpdatesInstalled } from '../../build/utils/updates';
import EasCommand from '../../commandUtils/EasCommand';
import Log, { learnMore } from '../../log';
import { RequestedPlatform } from '../../platform';
import { findProjectRootAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { getVcsClient } from '../../vcs';

export default class BuildConfigure extends EasCommand {
  static description = 'Configure the project to support EAS Build.';

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

    let platform: RequestedPlatform | undefined;
    if (expoUpdatesIsInstalled) {
      platform =
        (flags.platform as RequestedPlatform | undefined) ?? (await promptForPlatformAsync());
    }

    // ensure eas.json exists
    Log.newLine();
    await ensureProjectConfiguredAsync({
      projectDir,
      nonInteractive: false,
    });

    // configure expo-updates
    if (expoUpdatesIsInstalled) {
      assert(platform, 'platform must be defined here');

      const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });

      if ([RequestedPlatform.Android, RequestedPlatform.All].includes(platform)) {
        await syncAndroidUpdatesConfigurationAsync(projectDir, exp);
      }

      if ([RequestedPlatform.Ios, RequestedPlatform.All].includes(platform)) {
        await syncIosUpdatesConfigurationAsync(projectDir, exp);
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
