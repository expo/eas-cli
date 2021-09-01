import { Platform } from '@expo/eas-build-job';

export enum ReleaseStatus {
  completed = 'completed',
  draft = 'draft',
  halted = 'halted',
  inProgress = 'inProgress',
}

export enum ReleaseTrack {
  production = 'production',
  beta = 'beta',
  alpha = 'alpha',
  internal = 'internal',
}

export interface AndroidSubmitProfile {
  serviceAccountKeyPath?: string;
  track: ReleaseTrack;
  releaseStatus: ReleaseStatus;
  changesNotSentForReview: boolean;
}

export interface IosSubmitProfile {
  appleId?: string;
  ascAppId?: string;
  appleTeamId?: string;
  sku?: string;
  language: string;
  companyName?: string;
  appName?: string;
}

export type SubmitProfile<TPlatform extends Platform = Platform> =
  TPlatform extends Platform.ANDROID
    ? AndroidSubmitProfile
    : TPlatform extends Platform.IOS
    ? IosSubmitProfile
    : TPlatform extends Platform
    ? AndroidSubmitProfile | IosSubmitProfile
    : never;
