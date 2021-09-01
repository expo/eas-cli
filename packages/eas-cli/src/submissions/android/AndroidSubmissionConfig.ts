export interface AndroidSubmissionConfig {
  projectId: string;
  archiveUrl: string;
  androidPackage: string;
  track: ReleaseTrack;
  serviceAccount: string;
  releaseStatus?: ReleaseStatus;
  changesNotSentForReview: boolean;
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
