import chalk from 'chalk';
import * as path from 'node:path';
import slash from 'slash';

import { fileExistsAsync } from './utils';
import { WorkflowProjectSourceInput, WorkflowProjectSourceType } from '../../graphql/generated';
import Log from '../../log';
import { uploadAccountScopedFileAsync } from '../../project/uploadAccountScopedFileAsync';
import { uploadAccountScopedProjectSourceAsync } from '../../project/uploadAccountScopedProjectSourceAsync';
import { Client } from '../../vcs/vcs';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';

const MAX_CONFIG_FILE_SIZE_BYTES = 1024 * 1024;

/**
 * Packages the local project and uploads it, along with eas.json and package.json,
 * so it can be used as the project source of a workflow run.
 */
export async function uploadWorkflowProjectSourceAsync({
  graphqlClient,
  vcsClient,
  accountId,
  projectDir,
}: {
  graphqlClient: ExpoGraphqlClient;
  vcsClient: Client;
  accountId: string;
  projectDir: string;
}): Promise<WorkflowProjectSourceInput> {
  const easJsonPath = path.join(projectDir, 'eas.json');
  const packageJsonPath = path.join(projectDir, 'package.json');

  const projectRootDirectory = slash(
    path.relative(await vcsClient.getRootPathAsync(), projectDir) || '.'
  );

  let easJsonBucketKey: string | null = null;
  let packageJsonBucketKey: string | null = null;

  const { projectArchiveBucketKey } = await uploadAccountScopedProjectSourceAsync({
    graphqlClient,
    vcsClient,
    accountId,
  });

  if (await fileExistsAsync(easJsonPath)) {
    ({ fileBucketKey: easJsonBucketKey } = await uploadAccountScopedFileAsync({
      graphqlClient,
      accountId,
      filePath: easJsonPath,
      maxSizeBytes: MAX_CONFIG_FILE_SIZE_BYTES,
    }));
  } else {
    Log.warn(
      `⚠ No ${chalk.bold('eas.json')} found in the project directory. Running ${chalk.bold(
        'type: build'
      )} jobs will not work. Run ${chalk.bold(
        'eas build:configure'
      )} to configure your project for builds.`
    );
  }

  if (await fileExistsAsync(packageJsonPath)) {
    ({ fileBucketKey: packageJsonBucketKey } = await uploadAccountScopedFileAsync({
      graphqlClient,
      accountId,
      filePath: packageJsonPath,
      maxSizeBytes: MAX_CONFIG_FILE_SIZE_BYTES,
    }));
  } else {
    Log.warn(
      `⚠ No ${chalk.bold(
        'package.json'
      )} found in the project directory. It is used to automatically infer best job configuration for your project. You may want to define ${chalk.bold(
        'image'
      )} property in your workflow to specify the image to use.`
    );
  }

  return {
    type: WorkflowProjectSourceType.Gcs,
    projectArchiveBucketKey,
    easJsonBucketKey,
    packageJsonBucketKey,
    projectRootDirectory,
  };
}
