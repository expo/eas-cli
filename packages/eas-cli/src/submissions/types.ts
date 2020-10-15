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
