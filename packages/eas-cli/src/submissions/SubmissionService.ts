import { JSONObject } from '@expo/json-file';

import { apiClient } from '../api';
import { StartSubmissionResult, Submission, SubmissionConfig } from './SubmissionService.types';
import { SubmissionPlatform } from './types';

const SubmissionService = {
  startSubmissionAsync,
  getSubmissionAsync,
};

export const DEFAULT_CHECK_INTERVAL_MS = 5 * 1000; // 5 secs

async function startSubmissionAsync(
  platform: SubmissionPlatform,
  projectId: string,
  config: SubmissionConfig
): Promise<StartSubmissionResult> {
  const { data } = await apiClient
    .post(`projects/${projectId}/app-store-submissions`, {
      json: {
        platform,
        config: (config as unknown) as JSONObject,
      },
    })
    .json();
  return data.submissionId;
}

async function getSubmissionAsync(projectId: string, submissionId: string): Promise<Submission> {
  const { data } = await apiClient
    .get(`projects/${projectId}/app-store-submissions/${submissionId}`)
    .json();
  return data;
}

export default SubmissionService;
