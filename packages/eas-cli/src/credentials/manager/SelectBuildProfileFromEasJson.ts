import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonReader } from '@expo/eas-json';

import Log from '../../log';
import { promptAsync } from '../../prompts';

export class SelectBuildProfileFromEasJson<T extends Platform> {
  private easJsonReader: EasJsonReader;

  constructor(projectDir: string, private platform: T, private nonInteractive?: boolean) {
    this.easJsonReader = new EasJsonReader(projectDir);
  }

  async runAsync(maybeProfileName?: string): Promise<BuildProfile<T>> {
    const profileName = maybeProfileName || (await this.getProfileNameFromEasConfigAsync());
    const easConfig = await this.easJsonReader.getBuildProfileAsync<T>(this.platform, profileName);
    Log.succeed(`Using build profile: ${profileName}`);
    return easConfig;
  }

  async getProfileNameFromEasConfigAsync(): Promise<string> {
    const buildProfileNames = await this.easJsonReader.getBuildProfileNamesAsync();
    if (buildProfileNames.length === 0) {
      throw new Error(
        'You need at least one iOS build profile declared in eas.json. Go to https://docs.expo.dev/build/eas-json/ for more details'
      );
    } else if (buildProfileNames.length === 1) {
      return buildProfileNames[0];
    } else if (this.nonInteractive) {
      throw new Error('Must supply --profile when in non-interactive mode');
    }
    const { profileName } = await promptAsync({
      type: 'select',
      name: 'profileName',
      message: 'Which build profile do you want to configure?',
      choices: buildProfileNames.map(profileName => ({ value: profileName, title: profileName })),
    });
    return profileName;
  }
}
