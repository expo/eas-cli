export interface SubmissionContext<T extends SubmitCommandFlags> {
  projectDir: string;
  commandFlags: T;
}

export interface SubmitCommandFlags {
  latest: boolean;
  id?: string;
  path?: string;
  url?: string;
  verbose: boolean;
}

export enum SubmissionPlatform {
  Android = 'android',
  iOS = 'ios',
}

export enum AndroidArchiveType {
  apk = 'apk',
  aab = 'aab',
}

export enum IosArchiveType {
  ipa = 'ipa',
}

export type ArchiveType = AndroidArchiveType | IosArchiveType;

// Android specific types
export interface AndroidSubmitCommandFlags extends SubmitCommandFlags {
  type?: 'apk' | 'aab';
  key?: string;
  androidPackage?: string;
  track: string;
  releaseStatus: string;
}

export type AndroidSubmissionContext = SubmissionContext<AndroidSubmitCommandFlags>;
