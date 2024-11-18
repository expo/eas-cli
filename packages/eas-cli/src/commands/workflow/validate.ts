import { CombinedError } from '@urql/core';
import * as YAML from 'yaml';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { WorkflowRevisionMutation } from '../../graphql/mutations/WorkflowRevisionMutation';
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
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { path: filePath },
      flags,
    } = await this.parse(WorkflowValidate);

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      projectDir,
    } = await this.getContextAsync(WorkflowValidate, {
      nonInteractive: flags['non-interactive'],
      withServerSideEnvironment: null,
    });

    const {
      projectId,
      exp: { slug: projectName },
    } = await getDynamicPrivateProjectConfigAsync();
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    const spinner = ora().start('Validating the workflow YAML file…');

    try {
      const workflowFileContents = await WorkflowFile.readWorkflowFileContentsAsync({
        projectDir,
        filePath,
      });
      Log.log(`Using workflow file from ${workflowFileContents.filePath}`);

      const parsedYaml = YAML.parse(workflowFileContents.yamlConfig);

      // Check if the parsed result is empty or null
      if (
        parsedYaml === null ||
        parsedYaml === undefined ||
        (typeof parsedYaml === 'object' && Object.keys(parsedYaml).length === 0)
      ) {
        throw new Error('YAML file is empty or contains only comments.');
      }

      await WorkflowRevisionMutation.validateWorkflowYamlConfigAsync(graphqlClient, {
        appId: projectId,
        yamlConfig: workflowFileContents.yamlConfig,
      });

      spinner.succeed('Workflow configuration YAML is valid.');
    } catch (error) {
      spinner.fail('Workflow configuration YAML is not valid.');

      if (error instanceof YAML.YAMLParseError) {
        Log.error(`YAML syntax error: ${error.message}`);
      } else if (error instanceof CombinedError) {
        WorkflowFile.maybePrintWorkflowFileValidationErrors({
          error,
          accountName: account.name,
          projectName,
        });

        throw error;
      } else if (error instanceof Error) {
        Log.error(error.message);
      } else {
        Log.error(`Unexpected error: ${String(error)}`);
      }

      throw error;
    }
  }
}
