import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountUploadSessionType } from '../graphql/generated';
import { uploadAccountScopedFileAtPathToGCSAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { createProgressTracker } from '../utils/progress';

/**
 * Uploads a file to GCS as account-scoped object.
 * Used in workflows. Takes care of logging progress.
 * (Uses file name when mentioning file in logs.)
 */
export async function uploadAccountScopedFileAsync({
  graphqlClient,
  accountId,
  filePath,
  maxSizeBytes,
}: {
  graphqlClient: ExpoGraphqlClient;
  accountId: string;
  filePath: string;
  maxSizeBytes: number;
}): Promise<{ fileBucketKey: string }> {
  const fileName = path.basename(filePath);
  const fileStat = await fs.promises.stat(filePath);

  if (fileStat.size > maxSizeBytes) {
    throw new Error(`File is too big. Maximum allowed size is ${formatBytes(maxSizeBytes)}.`);
  }

  const fileBucketKey = await uploadAccountScopedFileAtPathToGCSAsync(graphqlClient, {
    accountId,
    type: AccountUploadSessionType.WorkflowsProjectSources,
    path: filePath,
    handleProgressEvent: createProgressTracker({
      total: fileStat.size,
      message: ratio =>
        `Uploading ${fileName} to EAS (${formatBytes(fileStat.size * ratio)} / ${formatBytes(
          fileStat.size
        )})`,
      completedMessage: (duration: string) => `Uploaded ${fileName} to EAS ${chalk.dim(duration)}`,
    }),
  });

  return { fileBucketKey };
}
