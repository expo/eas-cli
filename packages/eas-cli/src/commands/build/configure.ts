import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { configureAsync } from '../../build/configure';
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
    Log.newLine();

    await getVcsClient().ensureRepoExistsAsync();

    const platform =
      (flags.platform as RequestedPlatform | undefined) ?? (await promptForPlatformAsync());

    await configureAsync({
      platform,
      projectDir: await findProjectRootAsync(),
    });

    Log.newLine();
    logSuccess(platform);
  }
}

function logSuccess(platform: RequestedPlatform): void {
  let platformsText = 'iOS and Android projects are';
  let storesText = 'the Apple App Store or Google Play Store';

  if (platform === 'android') {
    platformsText = 'Android project is';
    storesText = 'the Google Play Store';
  } else if (platform === 'ios') {
    platformsText = 'iOS project is';
    storesText = 'the Apple App Store Connect';
  }

  Log.log(`🎉 Your ${platformsText} ready to build.

- Run ${chalk.bold('eas build')} when you are ready to create your first build.
- Once the build is completed, run ${chalk.bold('eas submit')} to upload the app to ${storesText}
- ${learnMore('https://docs.expo.dev/build/introduction', {
    learnMoreMessage: 'Learn more about other capabilities of EAS Build',
  })}`);
}

async function promptForPlatformAsync(): Promise<RequestedPlatform> {
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
