import { EasJsonReader, IosDistributionType as IosDistributionTypeEasConfig } from '@expo/eas-json';

import { promptAsync } from '../../prompts';

export class SelectIosDistributionTypeEasConfigFromBuildProfile {
  constructor(private easJsonReader: EasJsonReader) {}
  async runAsync(): Promise<IosDistributionTypeEasConfig> {
    const profileName = await this.getProfileNameFromEasConfigAsync();
    return this.getIosDistributionTypeFromBuildProfileAsync(profileName);
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

  async getIosDistributionTypeFromBuildProfileAsync(
    profileName: string
  ): Promise<IosDistributionTypeEasConfig> {
    const easConfig = await this.easJsonReader.readAsync(profileName);
    const distributionType = easConfig.builds.ios?.distribution;
    if (!distributionType) {
      throw new Error(
        `The distributionType field is required in your ${profileName} iOS build profile`
      );
    }
    return distributionType;
  }
}
