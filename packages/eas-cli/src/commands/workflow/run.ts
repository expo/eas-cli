import chalk from 'chalk';
import fs from 'node:fs';
import * as path from 'node:path';

import { EasBuildProjectArchiveUploadError } from '../../build/errors';
import { makeProjectTarballAsync } from '../../build/utils/repository';
import { getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AccountUploadSessionType, WorkflowProjectSourceType } from '../../graphql/generated';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import Log, { learnMore, link } from '../../log';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { uploadAccountScopedFileAtPathToGCSAsync } from '../../uploads';
import { formatBytes } from '../../utils/files';
import { enableJsonOutput } from '../../utils/json';
import { createProgressTracker } from '../../utils/progress';
import { Client } from '../../vcs/vcs';

export default class WorkflowRun extends EasCommand {
  static override description = 'Run an EAS workflow';
  static override aliases = ['workflow:run'];
  static override usage = [chalk`workflow:run {dim [options]}`];

  // TODO(@sjchmiela): Keep command hidden until workflows are live
  static override hidden = true;
  static override state = 'beta';

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override args = [{ name: 'file', description: 'Path to the workflow file to run' }];

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags, args } = await this.parse(WorkflowRun);

    if (flags.json) {
      enableJsonOutput();
    }

    Log.warn('Expo Workflows are in beta and subject to breaking changes.');

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      vcsClient,
      projectDir,
    } = await this.getContextAsync(WorkflowRun, {
      nonInteractive: flags['non-interactive'],
      withServerSideEnvironment: null,
    });

    const yamlConfig = await fs.promises.readFile(path.join(projectDir, args.file), 'utf8');

    const {
      projectId,
      exp: { slug: projectName },
    } = await getDynamicPrivateProjectConfigAsync();
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    const { easJsonBucketKey, projectArchiveBucketKey } = await uploadProjectAsync({
      graphqlClient,
      vcsClient,
      accountId: account.id,
      projectDir,
    });

    const { id: workflowRunId } = await WorkflowRunMutation.createWorkflowRunAsync(graphqlClient, {
      appId: projectId,
      workflowRevisionInput: {
        fileName: path.basename(args.file),
        yamlConfig,
      },
      workflowRunInput: {
        projectSource: {
          type: WorkflowProjectSourceType.Gcs,
          projectArchiveBucketKey,
          easJsonBucketKey,
        },
      },
    });

    Log.newLine();
    Log.succeed(
      `Workflow run created successfully. ${link(
        getWorkflowRunUrl(account.name, projectName, workflowRunId)
      )}`
    );
  }
}

async function uploadProjectAsync({
  graphqlClient,
  vcsClient,
  accountId,
  projectDir,
}: {
  graphqlClient: ExpoGraphqlClient;
  vcsClient: Client;
  accountId: string;
  projectDir: string;
}): Promise<{ projectArchiveBucketKey: string; easJsonBucketKey: string }> {
  let projectTarballPath;
  try {
    Log.newLine();
    Log.log(
      `Compressing project files and uploading to EAS. ${learnMore(
        'https://expo.fyi/eas-build-archive'
      )}`
    );
    const easJsonFilePath = path.join(projectDir, 'eas.json');

    const [projectTarball, easJsonFileStat] = await Promise.all([
      makeProjectTarballAsync(vcsClient),
      fs.promises.stat(easJsonFilePath),
    ]);

    if (projectTarball.size > 1024 * 1024 * 100) {
      Log.warn(
        `Your project archive is ${formatBytes(
          projectTarball.size
        )}. You can reduce its size and the time it takes to upload by excluding files that are unnecessary for the build process in ${chalk.bold(
          '.easignore'
        )} file. ${learnMore('https://expo.fyi/eas-build-archive')}`
      );
    }

    if (projectTarball.size > 2 * 1024 * 1024 * 1024) {
      throw new Error('Project archive is too big. Maximum allowed size is 2GB.');
    }
    if (easJsonFileStat.size > 1024 * 1024) {
      throw new Error('eas.json is too big. Maximum allowed size is 1MB.');
    }

    const projectArchiveProgressTracker = createProgressTracker({
      total: projectTarball.size,
      message: ratio =>
        `Uploading project archive to EAS (${formatBytes(
          projectTarball.size * ratio
        )} / ${formatBytes(projectTarball.size)})`,
      completedMessage: (duration: string) =>
        `Uploaded project archive to EAS ${chalk.dim(duration)}`,
    });
    const easJsonProgressTracker = createProgressTracker({
      total: easJsonFileStat.size,
      message: ratio =>
        `Uploading eas.json to EAS (${formatBytes(easJsonFileStat.size * ratio)} / ${formatBytes(
          easJsonFileStat.size
        )})`,
      completedMessage: (duration: string) => `Uploaded eas.json to EAS ${chalk.dim(duration)}`,
    });

    projectTarballPath = projectTarball.path;
    const [projectArchiveBucketKey, easJsonBucketKey] = await Promise.all([
      uploadAccountScopedFileAtPathToGCSAsync(graphqlClient, {
        accountId,
        type: AccountUploadSessionType.WorkflowsProjectSources,
        path: projectTarball.path,
        handleProgressEvent: projectArchiveProgressTracker,
      }),
      uploadAccountScopedFileAtPathToGCSAsync(graphqlClient, {
        accountId,
        type: AccountUploadSessionType.WorkflowsProjectSources,
        path: easJsonFilePath,
        handleProgressEvent: easJsonProgressTracker,
      }),
    ]);

    return { projectArchiveBucketKey, easJsonBucketKey };
  } catch (err: any) {
    let errMessage = 'Failed to upload the project tarball to EAS Build';

    if (err.message) {
      errMessage += `\n\nReason: ${err.message}`;
    }

    throw new EasBuildProjectArchiveUploadError(errMessage);
  } finally {
    if (projectTarballPath) {
      await fs.promises.rm(projectTarballPath);
    }
  }
}
