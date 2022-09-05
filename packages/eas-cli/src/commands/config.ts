import { getProjectConfigDescription } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { EasJsonReader } from '@expo/eas-json';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../commandUtils/EasCommand';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log from '../log';
import { appPlatformEmojis } from '../platform';
import { getExpoConfig } from '../project/expoConfig';
import { findProjectRootAsync } from '../project/projectUtils';
import { selectAsync } from '../prompts';

export default class Config extends EasCommand {
  static override description = 'display project configuration (app.json + eas.json)';

  static override flags = {
    platform: Flags.enum({ char: 'p', options: ['android', 'ios'] }),
    profile: Flags.string({ char: 'e' }),
  };

  protected override requiresAuthentication = false;

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(Config);
    const { platform: maybePlatform, profile: maybeProfile } = flags as {
      platform?: Platform;
      profile?: string;
    };

    const projectDir = await findProjectRootAsync();

    const reader = new EasJsonReader(projectDir);
    const profileName =
      maybeProfile ??
      (await selectAsync(
        'Select build profile',
        (
          await reader.getBuildProfileNamesAsync()
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

    const profile = await reader.getBuildProfileAsync(platform, profileName);
    const config = getExpoConfig(projectDir, { env: profile.env, isPublicConfig: true });

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
