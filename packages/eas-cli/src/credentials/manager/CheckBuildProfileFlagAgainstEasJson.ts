import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';

import Log from '../../log';

export class CheckBuildProfileFlagAgainstEasJson<T extends Platform> {
  private readonly easJsonAccessor: EasJsonAccessor;

  constructor(
    projectDir: string,
    private readonly platform: T,
    private readonly profileNameFromFlag: string
  ) {
    this.easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  }

  async runAsync(): Promise<BuildProfile<T>> {
    const profileName = await this.getProfileNameFromEasConfigAsync();
    const easConfig = await EasJsonUtils.getBuildProfileAsync<T>(
      this.easJsonAccessor,
      this.platform,
      profileName
    );
    Log.succeed(`Using build profile: ${profileName}`);
    return easConfig;
  }

  async getProfileNameFromEasConfigAsync(): Promise<string> {
    const buildProfileNames = await EasJsonUtils.getBuildProfileNamesAsync(this.easJsonAccessor);
    if (buildProfileNames.length === 0) {
      throw new Error(
        'You need at least one iOS build profile declared in eas.json. Go to https://docs.expo.dev/build/eas-json/ for more details'
      );
    } else if (buildProfileNames.length === 1) {
      return buildProfileNames[0];
    }

    if (buildProfileNames.includes(this.profileNameFromFlag)) {
      return this.profileNameFromFlag;
    } else {
      throw new Error(
        `Build profile ${this.profileNameFromFlag} does not exist in eas.json. Go to https://docs.expo.dev/build/eas-json/ for more details`
      );
    }
  }
}
