import { AndroidArchiveType } from '../types';

export interface AndroidSubmissionConfig {
  projectId: string;
  archiveUrl: string;
  archiveType: AndroidArchiveType;
  androidPackage: string;
  track: ReleaseTrack;
  serviceAccount: string;
  releaseStatus?: ReleaseStatus;
}

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
