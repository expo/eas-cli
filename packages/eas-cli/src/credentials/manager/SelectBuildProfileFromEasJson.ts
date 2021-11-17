import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonReader } from '@expo/eas-json';
import fs from 'fs-extra';

import Log, { learnMore } from '../../log';
import { promptAsync } from '../../prompts';
import { CredentialsContext } from '../context';

export class SelectBuildProfileFromEasJson<T extends Platform> {
  private easJsonReader: EasJsonReader;

  constructor(private projectDir: string, private platform: T) {
    this.easJsonReader = new EasJsonReader(projectDir);
  }

  async runAsync(ctx: CredentialsContext): Promise<BuildProfile<T>> {
    const easJsonPath = EasJsonReader.formatEasJsonPath(this.projectDir);
    if (!(await fs.pathExists(easJsonPath))) {
      throw new Error(
        `An eas.json file could not be found at ${easJsonPath}. You must make one in order to proceed. ${learnMore(
          'https://expo.fyi/eas-json'
        )}`
      );
    }

    const profileName = await this.getProfileNameFromEasConfigAsync(ctx);
    const easConfig = await this.easJsonReader.readBuildProfileAsync<T>(this.platform, profileName);
    Log.succeed(`Using build profile: ${profileName}`);
    return easConfig;
  }

  async getProfileNameFromEasConfigAsync(ctx: CredentialsContext): Promise<string> {
    const buildProfileNames = await this.easJsonReader.getBuildProfileNamesAsync();
    if (buildProfileNames.length === 0) {
      throw new Error(
        'You need at least one iOS build profile declared in eas.json. Go to https://docs.expo.dev/build/eas-json/ for more details'
      );
    } else if (buildProfileNames.length === 1) {
      return buildProfileNames[0];
    }
    if (ctx.nonInteractive) {
      throw new Error(
        'You have multiple build profiles. Please run this command in interactive mode.'
      );
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
