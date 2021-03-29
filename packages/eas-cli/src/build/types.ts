import { Metadata, Platform, errors } from '@expo/eas-build-job';
import { AndroidBuildProfile, iOSBuildProfile } from '@expo/eas-json';

export enum RequestedPlatform {
  Android = 'android',
  iOS = 'ios',
  All = 'all',
}

export { Platform };

export enum BuildStatus {
  IN_QUEUE = 'in-queue',
  IN_PROGRESS = 'in-progress',
  ERRORED = 'errored',
  FINISHED = 'finished',
  CANCELED = 'canceled',
}

export type TrackingContext = Record<string, string | number>;

export interface Build {
  id: string;
  status: BuildStatus;
  platform: Platform;
  createdAt: string;
  updatedAt: string;
  artifacts?: BuildArtifacts;
  metadata?: Partial<Metadata>;
  error?: errors.ExternalUserError;
}

interface BuildArtifacts {
  buildUrl?: string;
  logsUrl: string;
}

export type PlatformBuildProfile<T extends Platform> = T extends Platform.ANDROID
  ? AndroidBuildProfile
  : iOSBuildProfile;
