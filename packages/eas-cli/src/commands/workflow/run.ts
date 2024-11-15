import { CombinedError } from '@urql/core';
import fs from 'node:fs';
import * as path from 'node:path';

import { getProjectGitHubSettingsUrl, getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { WorkflowProjectSourceType } from '../../graphql/generated';
import { WorkflowRevisionMutation } from '../../graphql/mutations/WorkflowRevisionMutation';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import Log, { link } from '../../log';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { uploadAccountScopedEasJsonAsync } from '../../project/uploadAccountScopedEasJsonAsync';
import { uploadAccountScopedProjectSourceAsync } from '../../project/uploadAccountScopedProjectSourceAsync';

export default class WorkflowRun extends EasCommand {
  static override description = 'Run an EAS workflow';

  // TODO(@sjchmiela): Keep command hidden until workflows are live
  static override hidden = true;
  static override state = 'beta';

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

    Log.warn('Workflows are in beta and subject to breaking changes.');

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
      yamlConfig = await fs.promises.readFile(path.join(projectDir, args.file), 'utf8');
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
    } catch (err) {
      if (err instanceof CombinedError) {
        const validationErrors = err.graphQLErrors.flatMap(e => {
          return (
            WorkflowRevisionMutation.ValidationErrorExtensionZ.safeParse(e.extensions).data ?? []
          );
        });

        if (validationErrors.length > 0) {
          Log.error('Workflow file is invalid. Issues:');
          for (const validationError of validationErrors) {
            for (const formError of validationError.metadata.formErrors) {
              Log.error(`- ${formError}`);
            }

            for (const [field, fieldErrors] of Object.entries(
              validationError.metadata.fieldErrors
            )) {
              Log.error(`- ${field}: ${fieldErrors.join(', ')}`);
            }
          }
        }

        const githubNotFoundError = err.graphQLErrors.find(
          e => e.extensions.errorCode === 'GITHUB_NOT_FOUND_ERROR'
        );
        if (githubNotFoundError) {
          Log.error(`GitHub repository not found. It is currently required to run workflows.`);
          Log.error(
            `Please check that the repository exists and that you have access to it. ${link(
              getProjectGitHubSettingsUrl(account.name, projectName)
            )}`
          );
        }
      }

      throw err;
    }

    let projectArchiveBucketKey: string;
    let easJsonBucketKey: string;

    try {
      ({ projectArchiveBucketKey } = await uploadAccountScopedProjectSourceAsync({
        graphqlClient,
        vcsClient,
        accountId: account.id,
      }));
      ({ easJsonBucketKey } = await uploadAccountScopedEasJsonAsync({
        graphqlClient,
        accountId: account.id,
        projectDir,
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
            },
          },
        }
      );

      Log.newLine();
      Log.succeed(
        `Workflow started successfully. ${link(
          getWorkflowRunUrl(account.name, projectName, workflowRunId)
        )}`
      );
    } catch (err) {
      Log.error('Failed to start the workflow with the API.');

      throw err;
    }
  }
}
