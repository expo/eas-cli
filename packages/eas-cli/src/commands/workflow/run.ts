import { CombinedError } from '@urql/core';
import * as path from 'node:path';

import { getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { WorkflowProjectSourceType } from '../../graphql/generated';
import { WorkflowRevisionMutation } from '../../graphql/mutations/WorkflowRevisionMutation';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import Log, { link } from '../../log';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { uploadAccountScopedFileAsync } from '../../project/uploadAccountScopedFileAsync';
import { uploadAccountScopedProjectSourceAsync } from '../../project/uploadAccountScopedProjectSourceAsync';
import { WorkflowFile } from '../../utils/workflowFile';

export default class WorkflowRun extends EasCommand {
  static override description = 'Run an EAS workflow';

  static override args = [{ name: 'file', description: 'Path to the workflow file to run' }];

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags, args } = await this.parse(WorkflowRun);

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      vcsClient,
      projectDir,
    } = await this.getContextAsync(WorkflowRun, {
      nonInteractive: flags['non-interactive'],
      withServerSideEnvironment: null,
    });

    let yamlConfig: string;
    try {
      const workflowFileContents = await WorkflowFile.readWorkflowFileContentsAsync({
        projectDir,
        filePath: args.file,
      });
      Log.log(`Using workflow file from ${workflowFileContents.filePath}`);
      yamlConfig = workflowFileContents.yamlConfig;
    } catch (err) {
      Log.error('Failed to read workflow file.');

      throw err;
    }

    const {
      projectId,
      exp: { slug: projectName },
    } = await getDynamicPrivateProjectConfigAsync();
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    try {
      await WorkflowRevisionMutation.validateWorkflowYamlConfigAsync(graphqlClient, {
        appId: projectId,
        yamlConfig,
      });
    } catch (error) {
      if (error instanceof CombinedError) {
        WorkflowFile.maybePrintWorkflowFileValidationErrors({
          error,
          accountName: account.name,
          projectName,
        });

        throw error;
      }
    }

    let projectArchiveBucketKey: string;
    let easJsonBucketKey: string;
    let packageJsonBucketKey: string;

    try {
      ({ projectArchiveBucketKey } = await uploadAccountScopedProjectSourceAsync({
        graphqlClient,
        vcsClient,
        accountId: account.id,
      }));
      ({ fileBucketKey: easJsonBucketKey } = await uploadAccountScopedFileAsync({
        graphqlClient,
        accountId: account.id,
        filePath: path.join(projectDir, 'eas.json'),
        maxSizeBytes: 1024 * 1024,
      }));
      ({ fileBucketKey: packageJsonBucketKey } = await uploadAccountScopedFileAsync({
        graphqlClient,
        accountId: account.id,
        filePath: path.join(projectDir, 'package.json'),
        maxSizeBytes: 1024 * 1024,
      }));
    } catch (err) {
      Log.error('Failed to upload project sources.');

      throw err;
    }

    try {
      const { id: workflowRunId } = await WorkflowRunMutation.createWorkflowRunAsync(
        graphqlClient,
        {
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
              packageJsonBucketKey,
            },
          },
        }
      );

      Log.newLine();
      Log.succeed(
        `Workflow run started successfully. See logs: ${link(
          getWorkflowRunUrl(account.name, projectName, workflowRunId)
        )}`
      );
    } catch (err) {
      Log.error('Failed to start the workflow with the API.');

      throw err;
    }
  }
}
