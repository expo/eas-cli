import { AndroidSubmissionConfig } from './android/AndroidSubmissionConfig';
import { SubmissionPlatform } from './types';

export interface Submission {
  id: string;
  accountId: string;
  userId: string;
  platform: SubmissionPlatform;
  status: SubmissionStatus;
  submissionInfo?: SubmissionInfo;
  createdAt: Date;
  updatedAt: Date;
}

export enum SubmissionStatus {
  IN_QUEUE = 'in-queue',
  IN_PROGRESS = 'in-progress',
  FINISHED = 'finished',
  ERRORED = 'errored',
}

interface SubmissionInfo {
  logsUrl?: string;
  error?: SubmissionError;
}

export interface SubmissionError {
  errorCode: string;
  message: string;
}

// TODO: add `| iOSSubmissionConfig` when iOS submissions are supported
export type SubmissionConfig = AndroidSubmissionConfig;

export type StartSubmissionResult = string;
