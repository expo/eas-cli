import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import {
  customizeTemplateIfNeededAsync,
  workflowStarters,
} from '../../commandUtils/workflow/creation';
import {
  logWorkflowValidationErrors,
  validateWorkflowFileAsync,
  workflowContentsFromParsedYaml,
} from '../../commandUtils/workflow/validation';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { WorkflowFile } from '../../utils/workflowFile';

export class WorkflowCreate extends EasCommand {
  static override description = 'create a new workflow configuration YAML file';

  static override args = [
    {
      name: 'name',
      description: 'Name of the workflow file (must end with .yml or .yaml)',
      required: false,
    },
  ];

  static override flags = {
    'skip-validation': Flags.boolean({
      description: 'If set, the workflow file will not be validated before being created',
      default: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { name: argFileName },
      flags,
    } = await this.parse(WorkflowCreate);

    try {
      const {
        getDynamicPrivateProjectConfigAsync,
        loggedIn: { graphqlClient },
        projectDir,
      } = await this.getContextAsync(WorkflowCreate, {
        nonInteractive: false,
        withServerSideEnvironment: null,
      });

      const { exp: expPossiblyWithoutEasUpdateConfigured, projectId } =
        await getDynamicPrivateProjectConfigAsync();

      let fileName = argFileName;
      let filePath;

      let workflowStarter = (
        await promptAsync({
          type: 'select',
          name: 'starter',
          message: 'Select a workflow template:',
          choices: workflowStarters.map(starter => ({
            title: starter.displayName,
            value: starter,
          })),
        })
      ).starter;

      while ((fileName?.length ?? 0) === 0) {
        fileName = (
          await promptAsync({
            type: 'text',
            name: 'fileName',
            message: 'What would you like to name your workflow file?',
            initial: workflowStarter.defaultFileName,
          })
        ).fileName;
        try {
          WorkflowFile.validateYamlExtension(fileName);
        } catch (error) {
          Log.error(error instanceof Error ? error.message : 'Invalid YAML file name extension');
          filePath = undefined;
          fileName = undefined;
        }
        filePath = path.join(projectDir, '.eas', 'workflows', fileName);
        if (await fsExtra.pathExists(filePath)) {
          Log.error(`Workflow file already exists: ${filePath}`);
          Log.error('Please choose a different file name.');
          Log.newLine();
          filePath = undefined;
          fileName = undefined;
        }
      }

      // Customize the template if needed
      workflowStarter = await customizeTemplateIfNeededAsync(
        workflowStarter,
        projectDir,
        expPossiblyWithoutEasUpdateConfigured
      );

      Log.debug(`Creating workflow file ${fileName} from template ${workflowStarter.name}`);
      const yamlString = [
        ...workflowStarter.headerLines,
        workflowContentsFromParsedYaml(workflowStarter.template),
      ].join('\n');

      if (!flags['skip-validation']) {
        await validateWorkflowFileAsync(
          { yamlConfig: yamlString, filePath: fileName },
          projectDir,
          graphqlClient,
          projectId
        );
      }
      await this.ensureWorkflowsDirectoryExistsAsync({ projectDir });
      filePath && (await fs.writeFile(filePath, yamlString));
      Log.withTick(`Created ${chalk.bold(filePath)}`);
    } catch (error) {
      logWorkflowValidationErrors(error);
      Log.error('Failed to create workflow file.');
    }
  }

  private async ensureWorkflowsDirectoryExistsAsync({
    projectDir,
  }: {
    projectDir: string;
  }): Promise<void> {
    try {
      await fs.access(path.join(projectDir, '.eas', 'workflows'));
    } catch {
      await fs.mkdir(path.join(projectDir, '.eas', 'workflows'), { recursive: true });
      Log.withTick(`Created directory ${chalk.bold(path.join(projectDir, '.eas', 'workflows'))}`);
    }
  }
}
