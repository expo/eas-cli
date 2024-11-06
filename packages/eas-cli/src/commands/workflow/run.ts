import chalk from 'chalk';
import fs from 'node:fs';
import * as path from 'node:path';

import { getWorkflowRunUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { WorkflowProjectSourceType } from '../../graphql/generated';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import Log, { link } from '../../log';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { uploadAccountScopedEasJsonAsync } from '../../project/uploadAccountScopedEasJsonAsync';
import { uploadAccountScopedProjectSourceAsync } from '../../project/uploadAccountScopedProjectSourceAsync';

export default class WorkflowRun extends EasCommand {
  static override description = 'Run an EAS workflow';
  static override aliases = ['workflow:run'];
  static override usage = [chalk`workflow:run {dim [options]}`];

  // TODO(@sjchmiela): Keep command hidden until workflows are live
  static override hidden = true;
  static override state = 'beta';

  static override args = [{ name: 'file', description: 'Path to the workflow file to run' }];

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

    const yamlConfig = await fs.promises.readFile(path.join(projectDir, args.file), 'utf8');

    const {
      projectId,
      exp: { slug: projectName },
    } = await getDynamicPrivateProjectConfigAsync();
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    let projectArchiveBucketKey: string;
    let easJsonBucketKey: string;

    try {
      [{ projectArchiveBucketKey }, { easJsonBucketKey }] = await Promise.all([
        uploadAccountScopedProjectSourceAsync({
          graphqlClient,
          vcsClient,
          accountId: account.id,
        }),
        uploadAccountScopedEasJsonAsync({
          graphqlClient,
          accountId: account.id,
          projectDir,
        }),
      ]);
    } catch (err) {
      Log.error('Failed to upload project sources.');

      throw err;
    }

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
      `Workflow started successfully. ${link(
        getWorkflowRunUrl(account.name, projectName, workflowRunId)
      )}`
    );
  }
}
