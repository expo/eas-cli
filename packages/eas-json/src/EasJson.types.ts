import { Platform } from '@expo/eas-build-job';

import { AndroidBuildProfile, CommonBuildProfile, IosBuildProfile } from './EasBuild.types';
import { AndroidSubmitProfile, IosSubmitProfile } from './EasSubmit.types';

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
}

export interface RawBuildProfile extends Partial<CommonBuildProfile> {
  extends?: string;
  [Platform.ANDROID]?: Partial<AndroidBuildProfile>;
  [Platform.IOS]?: Partial<IosBuildProfile>;
}

export interface EasSubmitConfiguration {
  [Platform.ANDROID]?: AndroidSubmitProfile;
  [Platform.IOS]?: IosSubmitProfile;
}

export interface EasJson {
  build: { [profile: string]: RawBuildProfile };
  submit?: { [profile: string]: EasSubmitConfiguration };
}
