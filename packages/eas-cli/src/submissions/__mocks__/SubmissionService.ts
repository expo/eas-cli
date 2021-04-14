import { v4 as uuid } from 'uuid';

import { AppPlatform, SubmissionFragment, SubmissionStatus } from '../../graphql/generated';
import { StartSubmissionResult, SubmissionConfig } from '../SubmissionService';

const SubmissionService = {
  startSubmissionAsync,
  getSubmissionAsync,
};

export const DEFAULT_CHECK_INTERVAL_MS = 0;

const submissionStore: Record<string, SubmissionFragment> = {};

async function startSubmissionAsync(
  platform: AppPlatform,
  _projectId: string,
  _config: SubmissionConfig
): Promise<StartSubmissionResult> {
  const id = uuid();
  const submission: SubmissionFragment = {
    id,
    platform,
    status: SubmissionStatus.InQueue,
  };
  submissionStore[id] = submission;
  return Promise.resolve(id);
}

async function getSubmissionAsync(submissionId: string): Promise<SubmissionFragment> {
  return submissionStore[submissionId];
}

export default SubmissionService;
