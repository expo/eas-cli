import { SubmissionContext, SubmitCommandFlags } from '../types';

export interface AndroidSubmitCommandFlags extends SubmitCommandFlags {
  type?: 'apk' | 'aab';
  key?: string;
  androidPackage?: string;
  track: string;
  releaseStatus: string;
}

export type AndroidSubmissionContext = SubmissionContext<AndroidSubmitCommandFlags>;
