import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import {
  logWorkflowValidationErrors,
  validateWorkflowFileAsync,
} from '../../commandUtils/workflow/validation';
import { AccountFragment } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { WorkflowFile } from '../../utils/workflowFile';

export class WorkflowValidate extends EasCommand {
  static override description = 'validate a workflow configuration yaml file';

  static override args = [
    {
      name: 'path',
      description: 'Path to the workflow configuration YAML file (must end with .yml or .yaml)',
      required: true,
    },
  ];

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { path: filePath },
      flags,
    } = await this.parse(WorkflowValidate);

    let account: AccountFragment | undefined;
    let projectName: string | undefined;
    const spinner = ora().start('Validating the workflow YAML file…');
    try {
      const {
        getDynamicPrivateProjectConfigAsync,
        loggedIn: { graphqlClient },
        projectDir,
        projectId,
      } = await this.getContextAsync(WorkflowValidate, {
        nonInteractive: flags['non-interactive'],
        withServerSideEnvironment: null,
      });

      const {
        exp: { slug: maybeProjectName },
      } = await getDynamicPrivateProjectConfigAsync();
      projectName = maybeProjectName;

      account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

      const workflowFileContents = await WorkflowFile.readWorkflowFileContentsAsync({
        projectDir,
        filePath,
      });
      Log.log(`Using workflow file from ${workflowFileContents.filePath}`);

      await validateWorkflowFileAsync(workflowFileContents, projectDir, graphqlClient, projectId);

      spinner.succeed('Workflow configuration YAML is valid.');
    } catch (error) {
      spinner.fail('Workflow configuration YAML is not valid.');

      logWorkflowValidationErrors(error, account, projectName);
    }
  }
}
