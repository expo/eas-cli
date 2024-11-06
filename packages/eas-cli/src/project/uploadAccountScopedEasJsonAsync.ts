import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountUploadSessionType } from '../graphql/generated';
import { uploadAccountScopedFileAtPathToGCSAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { createProgressTracker } from '../utils/progress';

/**
 * Uploads the `eas.json` file to GCS as account-scoped object.
 * Used in workflows. Takes care of logging progress.
 */
export async function uploadAccountScopedEasJsonAsync({
  graphqlClient,
  accountId,
  projectDir,
}: {
  graphqlClient: ExpoGraphqlClient;
  accountId: string;
  projectDir: string;
}): Promise<{ easJsonBucketKey: string }> {
  const easJsonFilePath = path.join(projectDir, 'eas.json');

  const easJsonFileStat = await fs.promises.stat(easJsonFilePath);

  if (easJsonFileStat.size > 1024 * 1024) {
    throw new Error('eas.json is too big. Maximum allowed size is 1MB.');
  }

  const easJsonBucketKey = await uploadAccountScopedFileAtPathToGCSAsync(graphqlClient, {
    accountId,
    type: AccountUploadSessionType.WorkflowsProjectSources,
    path: easJsonFilePath,
    handleProgressEvent: createProgressTracker({
      total: easJsonFileStat.size,
      message: ratio =>
        `Uploading eas.json to EAS (${formatBytes(easJsonFileStat.size * ratio)} / ${formatBytes(
          easJsonFileStat.size
        )})`,
      completedMessage: (duration: string) => `Uploaded eas.json to EAS ${chalk.dim(duration)}`,
    }),
  });

  return { easJsonBucketKey };
}
