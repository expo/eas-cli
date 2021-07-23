import { getProjectConfigDescription } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { EasJsonReader } from '@expo/eas-json';
import { Command, flags } from '@oclif/command';

import Log from '../log';
import { getExpoConfig } from '../project/expoConfig';
import { findProjectRootAsync } from '../project/projectUtils';
import { selectAsync } from '../prompts';
import { handleDeprecatedEasJsonAsync } from './build';
export { Platform } from '@expo/eas-build-job';

export default class Config extends Command {
  static description = 'Show the eas.json config';

  static flags = {
    platform: flags.enum({ char: 'p', options: ['android', 'ios'] }),
    profile: flags.string(),
  };

  async run() {
    const { flags } = this.parse(Config);
    const { platform: maybePlatform, profile: maybeProfile } = flags as {
      platform?: Platform;
      profile?: string;
    };

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
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

    const profile = await reader.readBuildProfileAsync(profileName, platform);
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
