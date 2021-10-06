import { getProjectConfigDescription } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { EasJsonReader } from '@expo/eas-json';
import { flags } from '@oclif/command';

import EasCommand from '../commandUtils/EasCommand';
import Log from '../log';
import { getExpoConfig } from '../project/expoConfig';
import { findProjectRootAsync } from '../project/projectUtils';
import { selectAsync } from '../prompts';
import { handleDeprecatedEasJsonAsync } from './build';

export default class Config extends EasCommand {
  static description = 'show the eas.json config';

  static flags = {
    platform: flags.enum({ char: 'p', options: ['android', 'ios'] }),
    profile: flags.string(),
  };

  protected requiresAuthentication = false;

  async runAsync(): Promise<void> {
    const { flags } = this.parse(Config);
    const { platform: maybePlatform, profile: maybeProfile } = flags as {
      platform?: Platform;
      profile?: string;
    };

    const projectDir = await findProjectRootAsync();
    await handleDeprecatedEasJsonAsync(projectDir, false);

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

    const profile = await reader.readBuildProfileAsync(platform, profileName);
    const config = getExpoConfig(projectDir, { env: profile.env, isPublicConfig: true });

    Log.log(getProjectConfigDescription(projectDir));
    Log.newLine();
    Log.log(JSON.stringify(config, null, 2));
    Log.newLine();
    Log.newLine();
    Log.log(`Build profile "${profileName}" from eas.json for platform ${platform}`);
    Log.newLine();
    Log.log(JSON.stringify(profile, null, 2));
  }
}
