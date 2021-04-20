import { EasConfig, EasJsonReader } from '@expo/eas-json';
import Log from '../../log';

import { promptAsync } from '../../prompts';
import { Context } from '../context';

export class SelectBuildProfileFromEasJson {
  constructor(private easJsonReader: EasJsonReader) {}
  async runAsync(ctx: Context): Promise<EasConfig> {
    const profileName = await this.getProfileNameFromEasConfigAsync(ctx);
    const easConfig = await this.easJsonReader.readAsync(profileName);
    Log.succeed(`Using build profile: ${profileName}`);
    return easConfig;
  }

  async getProfileNameFromEasConfigAsync(ctx: Context): Promise<string> {
    const easJson = await this.easJsonReader.readRawAsync();
    const buildProfileNames = Object.keys(easJson.builds?.ios || {});
    if (buildProfileNames.length === 0) {
      throw new Error(
        'You need at least one iOS build profile declared in eas.json. Go to https://docs.expo.io/build/eas-json/ for more details'
      );
    } else if (buildProfileNames.length === 1) {
      return buildProfileNames[0];
    }
    if (ctx.nonInteractive) {
      throw new Error('You have multiple build profiles. Please run this command in interactive mode.')
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
