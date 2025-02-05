import chalk from 'chalk';
import fs from 'node:fs';

import {
  assertProjectTarballSizeDoesNotExceedLimit,
  makeProjectTarballAsync,
  maybeWarnAboutProjectTarballSize,
} from '../build/utils/repository';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountUploadSessionType } from '../graphql/generated';
import Log, { learnMore } from '../log';
import { uploadAccountScopedFileAtPathToGCSAsync } from '../uploads';
import { formatBytes } from '../utils/files';
import { createProgressTracker } from '../utils/progress';
import { Client } from '../vcs/vcs';

/**
 * Archives the project and uploads it to GCS as account-scoped object.
 * Used in workflows. Takes care of logging progress and cleaning up the tarball.
 */
export async function uploadAccountScopedProjectSourceAsync({
  graphqlClient,
  vcsClient,
  accountId,
}: {
  graphqlClient: ExpoGraphqlClient;
  vcsClient: Client;
  accountId: string;
}): Promise<{ projectArchiveBucketKey: string }> {
  let projectTarballPath;

  try {
    Log.newLine();
    Log.log(
      `Compressing project files and uploading to EAS. ${learnMore(
        'https://expo.fyi/eas-build-archive'
      )}`
    );

    const projectTarball = await makeProjectTarballAsync(vcsClient);
    projectTarballPath = projectTarball.path;

    maybeWarnAboutProjectTarballSize(projectTarball.size);
    assertProjectTarballSizeDoesNotExceedLimit(projectTarball.size);

    const projectArchiveBucketKey = await uploadAccountScopedFileAtPathToGCSAsync(graphqlClient, {
      accountId,
      type: AccountUploadSessionType.WorkflowsProjectSources,
      path: projectTarball.path,
      handleProgressEvent: createProgressTracker({
        total: projectTarball.size,
        message: ratio =>
          `Uploading project archive to EAS (${formatBytes(
            projectTarball.size * ratio
          )} / ${formatBytes(projectTarball.size)})`,
        completedMessage: (duration: string) =>
          `Uploaded project archive to EAS ${chalk.dim(duration)}`,
      }),
    });

    return { projectArchiveBucketKey };
  } finally {
    if (projectTarballPath) {
      await fs.promises.rm(projectTarballPath);
    }
  }
}
