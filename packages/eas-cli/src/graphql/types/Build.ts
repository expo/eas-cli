import { ActivityTimelineProjectActivity } from './ActivityTimelineProjectActivity';
import { Project } from './Project';

export enum BuildStatus {
  InQueue = 'IN_QUEUE',
  InProgress = 'IN_PROGRESS',
  Errored = 'ERRORED',
  Finished = 'FINISHED',
}

export enum BuildPlatform {
  Android = 'ANDROID',
  iOS = 'IOS',
}

export interface Build extends ActivityTimelineProjectActivity {
  id: string;
  platform: BuildPlatform;
  status: BuildStatus;
  artifacts: {
    buildUrl: string;
  };
  project: Project;
  logFiles?: string[];
  expirationDate?: Date;
  appVersion?: string;
  sdkVersion?: string;
  releaseChannel?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
