import { Platform } from '@expo/eas-build-job';

export enum AndroidReleaseStatus {
  completed = 'completed',
  draft = 'draft',
  halted = 'halted',
  inProgress = 'inProgress',
}

export interface AndroidSubmitProfile {
  serviceAccountKeyPath?: string;
  track: string;
  releaseStatus: AndroidReleaseStatus;
  changesNotSentForReview: boolean;
  applicationId?: string;
  rollout?: number;
}

export const AndroidSubmitProfileFieldsToEvaluate: (keyof AndroidSubmitProfile)[] = [
  'serviceAccountKeyPath',
];

export interface IosSubmitProfile {
  ascApiKeyPath?: string;
  ascApiKeyIssuerId?: string;
  ascApiKeyId?: string;
  appleId?: string;
  ascAppId?: string;
  appleTeamId?: string;
  sku?: string;
  language?: string;
  companyName?: string;
  appName?: string;
  bundleIdentifier?: string;
  metadataPath?: string;
  groups?: string[];
}

export const IosSubmitProfileFieldsToEvaluate: (keyof IosSubmitProfile)[] = [
  'ascApiKeyPath',
  'ascApiKeyIssuerId',
  'ascApiKeyId',
];

export type SubmitProfile<TPlatform extends Platform = Platform> =
  TPlatform extends Platform.ANDROID ? AndroidSubmitProfile : IosSubmitProfile;

export interface EasJsonSubmitProfile {
  extends?: string;
  [Platform.ANDROID]?: AndroidSubmitProfile;
  [Platform.IOS]?: IosSubmitProfile;
}
