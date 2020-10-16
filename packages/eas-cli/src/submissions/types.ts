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

// Android specific types
export interface AndroidSubmitCommandFlags extends SubmitCommandFlags {
  type?: 'apk' | 'aab';
  key?: string;
  androidPackage?: string;
  track: string;
  releaseStatus: string;
}

export type AndroidSubmissionContext = SubmissionContext<AndroidSubmitCommandFlags>;
