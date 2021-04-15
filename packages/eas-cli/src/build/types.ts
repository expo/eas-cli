export { Platform } from '@expo/eas-build-job';

export enum RequestedPlatform {
  Android = 'android',
  Ios = 'ios',
  All = 'all',
}

export enum BuildStatus {
  IN_QUEUE = 'in-queue',
  IN_PROGRESS = 'in-progress',
  ERRORED = 'errored',
  FINISHED = 'finished',
  CANCELED = 'canceled',
}

export type TrackingContext = Record<string, string | number>;
