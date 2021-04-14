import { JSONObject } from '@expo/json-file';

import { AppPlatform, SubmissionFragment } from '../graphql/generated';
import { SubmissionMutation } from '../graphql/mutations/SubmissionMutation';
import { SubmissionQuery } from '../graphql/queries/SubmissionQuery';
import { StartSubmissionResult, Submission, SubmissionConfig } from './SubmissionService.types';
import { SubmissionPlatform } from './types';

const SubmissionService = {
  startSubmissionAsync,
  getSubmissionAsync,
};

export const DEFAULT_CHECK_INTERVAL_MS = 5 * 1000; // 5 secs

const submissionPlatformMappings: Record<SubmissionPlatform, AppPlatform> = {
  [SubmissionPlatform.Android]: AppPlatform.Android,
  [SubmissionPlatform.iOS]: AppPlatform.Ios,
};

async function startSubmissionAsync(
  platform: SubmissionPlatform,
  projectId: string,
  config: SubmissionConfig
): Promise<StartSubmissionResult> {
  const { submission } = await SubmissionMutation.createSubmissionAsync({
    appId: projectId,
    platform: submissionPlatformMappings[platform],
    config: (config as unknown) as JSONObject,
  });

  return submission.id;
}

async function getSubmissionAsync(submissionId: string): Promise<SubmissionFragment> {
  const submission = await SubmissionQuery.byIdAsync(submissionId, { useCache: false });

  return submission;
}

export default SubmissionService;
