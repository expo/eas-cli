import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import path from 'path';
import prompts from 'prompts';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import {
  WorkflowTemplate,
  WorkflowTemplateName,
  customizeTemplateIfNeededAsync,
  workflowTemplates,
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
    ...EASNonInteractiveFlag,
    template: Flags.enum({
      description: 'Name of the template to use',
      options: Object.values(WorkflowTemplateName),
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
        nonInteractive: flags['non-interactive'],
        withServerSideEnvironment: null,
      });

      const { projectId } = await getDynamicPrivateProjectConfigAsync();

      let fileName = argFileName;

      const nonInteractive = flags['non-interactive'];
      if (nonInteractive && !flags.template) {
        throw new Error('Template name must be provided in non-interactive mode');
      }

      let workflowTemplate: WorkflowTemplate;
      if (flags.template) {
        workflowTemplate =
          workflowTemplates.find(template => template.name === flags.template) ??
          workflowTemplates[0];
      } else {
        workflowTemplate = (
          await promptAsync({
            type: 'select',
            name: 'template',
            message: 'Select a workflow template:',
            choices: workflowTemplates.map(template => ({
              title: template.displayName,
              value: template,
            })),
          })
        ).template;
      }

      if (!fileName) {
        if (nonInteractive) {
          fileName = workflowTemplate.defaultFileName;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const response = await prompts({
            type: 'text',
            name: 'fileName',
            message: 'What would you like to name your workflow file?',
            initial: workflowTemplate.defaultFileName,
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
      }

      // Customize the template if needed
      workflowTemplate = await customizeTemplateIfNeededAsync(workflowTemplate, projectDir);

      Log.debug(`Creating workflow file ${fileName} from template ${workflowTemplate.name}`);
      const yamlString = workflowContentsFromParsedYaml(workflowTemplate.template);

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
