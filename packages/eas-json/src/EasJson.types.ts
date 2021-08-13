import { AndroidBuildProfile, CommonBuildProfile, IosBuildProfile } from './EasBuild.types';
import { AndroidSubmitProfile, IosSubmitProfile } from './EasSubmit.types';

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
}

export interface RawBuildProfile extends Partial<CommonBuildProfile> {
  extends?: string;
  android?: Partial<AndroidBuildProfile>;
  ios?: Partial<IosBuildProfile>;
}

export interface EasSubmitConfiguration {
  android?: AndroidSubmitProfile;
  ios?: IosSubmitProfile;
}

export interface EasJson {
  build: { [profile: string]: RawBuildProfile };
  submit?: { [profile: string]: EasSubmitConfiguration };
}
