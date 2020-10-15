export interface AndroidSubmissionConfig {
  projectId: string;
  archiveUrl: string;
  archiveType: ArchiveType;
  androidPackage: string;
  track: ReleaseTrack;
  serviceAccount: string;
  releaseStatus?: ReleaseStatus;
}

export enum AndroidArchiveType {
  apk = 'apk',
  aab = 'aab',
}
export enum IosArchiveType {
  ipa = 'ipa',
}

export type ArchiveType = AndroidArchiveType | IosArchiveType;

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
