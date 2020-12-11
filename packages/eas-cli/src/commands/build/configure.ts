import { Command, flags } from '@oclif/command';
import chalk from 'chalk';

import { configureAsync } from '../../build/configure';
import { RequestedPlatform } from '../../build/types';
import log, { learnMore } from '../../log';
import { findProjectRootAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';

export default class BuildConfigure extends Command {
  static description = 'Configure the project to support EAS Build.';

  static flags = {
    platform: flags.enum({
      description: 'Platform to configure',
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
    'allow-experimental': flags.boolean({
      description: 'Enable experimental configuration steps.',
      default: false,
    }),
  };

  async run() {
    const { flags } = this.parse(BuildConfigure);
    log(
      '💡 The following process will configure your iOS and/or Android project to be compatible with EAS Build. These changes only apply to your local project files and you can safely revert them at any time.'
    );
    log.newLine();

    const platform =
      (flags.platform as RequestedPlatform | undefined) ?? (await promptForPlatformAsync());
    const allowExperimental = flags['allow-experimental'];

    if (allowExperimental) {
      log.warn(
        `Project configuration will execute some additional steps that might fail if structure of your native project is significantly different from ${chalk.bold(
          'expo eject'
        )} or ${chalk.bold('expo init')}`
      );
    }

    await ensureLoggedInAsync();
    await configureAsync({
      platform,
      allowExperimental,
      projectDir: (await findProjectRootAsync()) ?? process.cwd(),
    });

    log.newLine();
    logSuccess(platform);
  }
}

function logSuccess(platform: RequestedPlatform) {
  let platformsText = 'iOS and Android projects are';
  let storesText = 'the Apple App Store or Google Play Store';

  if (platform === 'android') {
    platformsText = 'Android project is';
    storesText = 'the Google Play Store';
  } else if (platform === 'ios') {
    platformsText = 'iOS project is';
    storesText = 'the Apple App Store';
  }

  log(`🎉 Your ${platformsText} ready to build.

- Run ${chalk.bold('eas build')} when you are ready to create your first build.
- Once the build is completed, run ${chalk.bold('eas submit')} to upload the app to ${storesText}
- ${learnMore(
    'https://docs.expo.io/build/introduction',
    'Learn more about other capabilities of EAS Build'
  )}`);
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
        value: RequestedPlatform.iOS,
      },
      {
        title: 'Android',
        value: RequestedPlatform.Android,
      },
    ],
  });
  return platform;
}
