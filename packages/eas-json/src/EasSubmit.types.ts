import { Platform } from '@expo/eas-build-job';

export enum AndroidReleaseStatus {
  completed = 'completed',
  draft = 'draft',
  halted = 'halted',
  inProgress = 'inProgress',
}

export enum AndroidReleaseTrack {
  production = 'production',
  beta = 'beta',
  alpha = 'alpha',
  internal = 'internal',
}

export interface AndroidSubmitProfile {
  serviceAccountKeyPath?: string;
  track: AndroidReleaseTrack;
  releaseStatus: AndroidReleaseStatus;
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
