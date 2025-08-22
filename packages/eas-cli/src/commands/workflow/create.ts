import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import path from 'path';
import prompts from 'prompts';

import EasCommand from '../../commandUtils/EasCommand';
import {
  WorkflowStarter,
  WorkflowStarterName,
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
    template: Flags.enum({
      description: 'Name of the template to use',
      options: Object.values(WorkflowStarterName),
    }),
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

      let workflowStarter: WorkflowStarter;
      if (flags.template) {
        workflowStarter =
          workflowStarters.find(template => template.name === flags.template) ??
          workflowStarters[0];
      } else {
        workflowStarter = (
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
      }

      if (!fileName) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const response = await prompts({
          type: 'text',
          name: 'fileName',
          message: 'What would you like to name your workflow file?',
          initial: workflowStarter.defaultFileName,
          validate: value => {
            try {
              WorkflowFile.validateYamlExtension(value);
              return true;
            } catch (error) {
              return error instanceof Error ? error.message : 'Invalid file name';
            }
          },
        });
        if (!response.fileName) {
          Log.warn('Workflow creation cancelled.');
          process.exit(0);
        }

        fileName = response.fileName;
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
      await this.createWorkflowFileAsync({ fileName, projectDir, yamlString });
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

  private async createWorkflowFileAsync({
    fileName,
    projectDir,
    yamlString,
  }: {
    fileName: string;
    projectDir: string;
    yamlString: string;
  }): Promise<void> {
    WorkflowFile.validateYamlExtension(fileName);

    const filePath = path.join(projectDir, '.eas', 'workflows', fileName);

    if (await fsExtra.pathExists(filePath)) {
      throw new Error(`Workflow file already exists: ${filePath}`);
    }

    await fs.writeFile(filePath, yamlString);
    Log.withTick(`Created ${chalk.bold(filePath)}`);
  }
}
