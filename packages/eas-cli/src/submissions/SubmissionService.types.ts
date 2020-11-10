import { AndroidSubmissionConfig } from './android/AndroidSubmissionConfig';
import { IosSubmissionConfig } from './ios/IosSubmissionConfig';
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

export type SubmissionConfig = AndroidSubmissionConfig | IosSubmissionConfig;

export type StartSubmissionResult = string;
