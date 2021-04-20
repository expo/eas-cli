import { EasConfig, EasJsonReader } from '@expo/eas-json';

import { promptAsync } from '../../prompts';

export class SelectBuildProfileFromEasJson {
  constructor(private easJsonReader: EasJsonReader) {}
  async runAsync(): Promise<EasConfig> {
    const profileName = await this.getProfileNameFromEasConfigAsync();
    return await this.easJsonReader.readAsync(profileName);
  }

  async getProfileNameFromEasConfigAsync(): Promise<string> {
    const easJson = await this.easJsonReader.readRawAsync();
    const buildProfileNames = Object.keys(easJson.builds?.ios || {});
    if (buildProfileNames.length === 0) {
      throw new Error(
        'No iOS build profiles declared in eas.json. Go to https://docs.expo.io/build/eas-json/ for more details'
      );
    } else if (buildProfileNames.length === 1) {
      return buildProfileNames[0];
    }
    const { profileName } = await promptAsync({
      type: 'select',
      name: 'profileName',
      message: 'Which profile do you want to configure?',
      choices: buildProfileNames.map(profileName => ({ value: profileName, title: profileName })),
    });
    return profileName;
  }
}
