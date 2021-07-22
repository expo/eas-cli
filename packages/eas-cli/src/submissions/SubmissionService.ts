import { JSONObject } from '@expo/json-file';

import { AppPlatform, SubmissionFragment } from '../graphql/generated';
import { SubmissionMutation } from '../graphql/mutations/SubmissionMutation';
import { SubmissionQuery } from '../graphql/queries/SubmissionQuery';
import { AndroidSubmissionConfig } from './android/AndroidSubmissionConfig';
import { IosSubmissionConfig } from './ios/IosSubmissionConfig';

export type SubmissionConfig = AndroidSubmissionConfig | IosSubmissionConfig;

export type StartSubmissionResult = string;

const SubmissionService = {
  startSubmissionAsync,
  getSubmissionAsync,
};

export const DEFAULT_CHECK_INTERVAL_MS = 5 * 1000; // 5 secs

async function startSubmissionAsync(
  platform: AppPlatform,
  projectId: string,
  config: SubmissionConfig,
  buildId?: string
): Promise<StartSubmissionResult> {
  const { submission } = await SubmissionMutation.createSubmissionAsync({
    appId: projectId,
    platform,
    config: (config as unknown) as JSONObject,
    submittedBuildId: buildId,
  });
  return submission.id;
}

async function getSubmissionAsync(submissionId: string): Promise<SubmissionFragment> {
  return await SubmissionQuery.byIdAsync(submissionId, { useCache: false });
}

export default SubmissionService;
