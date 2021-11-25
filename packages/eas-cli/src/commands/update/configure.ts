import { ExpoConfig, getConfig, modifyConfigAsync } from '@expo/config';
import { flags } from '@oclif/command';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { RequestedPlatform } from '../../platform';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';

const EAS_UPDATE_URL = 'https://u.expo.dev';

export async function getEASUpdateURLAsync(exp: ExpoConfig): Promise<string> {
  const projectId = await getProjectIdAsync(exp);
  return new URL(projectId, EAS_UPDATE_URL).href;
}

async function ensureEASUrlSetAsync(projectDir: string, exp: ExpoConfig): Promise<void> {
  const easUpdateURL = await getEASUpdateURLAsync(exp);
  const currentURL = exp.updates?.url;
  if (currentURL) {
    Log.warn(
      `Overwriting current updates.url value, "${currentURL}", with "${easUpdateURL}" in app.json`
    );
  }

  const result = await modifyConfigAsync(projectDir, {
    updates: { ...exp.updates, url: easUpdateURL },
  });

  switch (result.type) {
    case 'success':
      break;
    case 'warn': {
      Log.log();
      Log.warn('It looks like you are using a dynamic configuration!');
      Log.log(
        chalk.dim(
          'https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs)\n'
        )
      );
      Log.warn(
        'In order to finish configuring your project for EAS Update, you are going to need manually add the following to your "extra" key:\n\n'
      );
      Log.log(chalk.bold(`"updates": {\n    "url": "${easUpdateURL}"\n  }`));
      throw new Error(result.message);
    }
    case 'fail':
      throw new Error(result.message);
    default:
      throw new Error('Unexpected result type from modifyConfigAsync');
  }
}

export default class UpdateConfigure extends EasCommand {
  static description = 'Configure the project to support EAS Update.';

  // static flags = {
  //   platform: flags.enum({
  //     description: 'Platform to configure',
  //     char: 'p',
  //     options: ['android', 'ios', 'all'],
  //   }),
  // };

  async runAsync(): Promise<void> {
    // const { flags } = this.parse(UpdateConfigure);
    // const platform =
    //   (flags.platform as RequestedPlatform | undefined) ?? (await promptForPlatformAsync());

    Log.log(
      '💡 The following process will configure your project to to run EAS Update. These changes only apply to your local project files and you can safely revert them at any time.'
    );
    Log.newLine();

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, {
      skipSDKVersionRequirement: true,
    });

    await ensureEASUrlSetAsync(projectDir, exp);

    // Log.log(`🎉 Your ${platformsText} ready to build.

    // - Run ${chalk.bold('eas build')} when you are ready to create your first build.
    // - Once the build is completed, run ${chalk.bold('eas submit')} to upload the app to ${storesText}
    // - ${learnMore('https://docs.expo.dev/build/introduction', {
    //     learnMoreMessage: 'Learn more about other capabilities of EAS Build',
    //   })}`);
    //   Log.log(`🎉 Your ${platformsText} ready to build.

    // - Run ${chalk.bold('eas build')} when you are ready to create your first build.
    // - Once the build is completed, run ${chalk.bold('eas submit')} to upload the app to ${storesText}
    // - ${learnMore('https://docs.expo.dev/build/introduction', {
    //     learnMoreMessage: 'Learn more about other capabilities of EAS Build',
    //   })}`);
  }
}
