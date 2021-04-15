export interface SubmissionContext<T extends SubmitCommandFlags> {
  projectDir: string;
  projectId: string;
  commandFlags: T;
}

export interface SubmitCommandFlags {
  latest: boolean;
  id?: string;
  path?: string;
  url?: string;
  verbose: boolean;
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

// iOS specific types
export interface IosSubmitCommandFlags extends SubmitCommandFlags {
  // common for all flows
  appleId?: string;
  ascAppId?: string;

  // used only when running produce
  appleTeamId?: string;
  itcTeamId?: string;
  appName?: string;
  bundleIdentifier?: string;
  sku?: string;
  language?: string;
  companyName?: string;
}

export type IosSubmissionContext = SubmissionContext<IosSubmitCommandFlags>;
