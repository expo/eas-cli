import { EasJsonBuildProfile } from './build/types';
import { EasJsonSubmitProfile } from './submit/types';

export type ProfileType = 'build' | 'submit';
export type EasJsonProfile<T extends ProfileType> = T extends 'build'
  ? EasJsonBuildProfile
  : EasJsonSubmitProfile;

export enum CredentialsSource {
  LOCAL = 'local',
  REMOTE = 'remote',
}

export enum AppVersionSource {
  LOCAL = 'local',
  REMOTE = 'remote',
}

export interface EasJson {
  cli?: {
    version?: string;
    requireCommit?: boolean;
    appVersionSource?: AppVersionSource;
    promptToConfigurePushNotifications?: boolean;
  };
  build?: { [profileName: string]: EasJsonBuildProfile };
  submit?: { [profileName: string]: EasJsonSubmitProfile };
}
