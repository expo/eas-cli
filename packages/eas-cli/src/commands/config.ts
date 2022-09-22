import { getProjectConfigDescription } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand, {
  EASCommandDynamicProjectConfigContext,
  EASCommandProjectDirContext,
} from '../commandUtils/EasCommand';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log from '../log';
import { appPlatformEmojis } from '../platform';
import { selectAsync } from '../prompts';

export default class Config extends EasCommand {
  static override description = 'display project configuration (app.json + eas.json)';

  static override flags = {
    platform: Flags.enum<Platform>({ char: 'p', options: [Platform.ANDROID, Platform.IOS] }),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
  };

  static override contextDefinition = {
    ...EASCommandDynamicProjectConfigContext,
    ...EASCommandProjectDirContext,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(Config);
    const { platform: maybePlatform, profile: maybeProfile } = flags;
    const { getDynamicProjectConfigAsync, projectDir } = await this.getContextAsync(Config, {
      nonInteractive: false,
    });

    const accessor = new EasJsonAccessor(projectDir);
    const profileName =
      maybeProfile ??
      (await selectAsync(
        'Select build profile',
        (
          await EasJsonUtils.getBuildProfileNamesAsync(accessor)
        ).map(profileName => ({
          title: profileName,
          value: profileName,
        }))
      ));
    const platform =
      maybePlatform ??
      (await selectAsync('Select platform', [
        {
          title: 'Android',
          value: Platform.ANDROID,
        },
        {
          title: 'iOS',
          value: Platform.IOS,
        },
      ]));

    const profile = await EasJsonUtils.getBuildProfileAsync(accessor, platform, profileName);
    const { exp: config } = await getDynamicProjectConfigAsync({
      env: profile.env,
      isPublicConfig: true,
    });

    Log.addNewLineIfNone();
    Log.log(chalk.bold(getProjectConfigDescription(projectDir)));
    Log.newLine();
    Log.log(JSON.stringify(config, null, 2));
    Log.newLine();
    Log.newLine();
    const appPlatform = toAppPlatform(platform);
    const platformEmoji = appPlatformEmojis[appPlatform];
    Log.log(`${platformEmoji} ${chalk.bold(`Build profile "${profileName}"`)}`);
    Log.newLine();
    Log.log(JSON.stringify(profile, null, 2));
  }
}
