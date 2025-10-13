import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import {
  runBuildConfigureIfNeededAsync,
  runUpdateConfigureIfNeededAsync,
} from '../../commandUtils/workflow/buildProfileUtils';
import {
  WorkflowStarter,
  WorkflowStarterName,
  customizeTemplateIfNeededAsync,
  howToRunWorkflow,
  workflowStarters,
} from '../../commandUtils/workflow/creation';
import {
  logWorkflowValidationErrors,
  validateWorkflowFileAsync,
  workflowContentsFromParsedYaml,
} from '../../commandUtils/workflow/validation';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import formatFields from '../../utils/formatFields';
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

      const { exp: originalExpoConfig, projectId } = await getDynamicPrivateProjectConfigAsync();
      let expoConfig = originalExpoConfig;

      let workflowStarter;
      while (!workflowStarter) {
        workflowStarter = await chooseTemplateAsync();
        switch (workflowStarter.name) {
          case WorkflowStarterName.BUILD:
          case WorkflowStarterName.DEPLOY:
          case WorkflowStarterName.UPDATE: {
            const shouldProceed = await runBuildConfigureIfNeededAsync({
              projectDir,
              expoConfig,
            });
            if (!shouldProceed) {
              workflowStarter = undefined;
              continue;
            }
            break;
          }
          default:
            break;
        }
        switch (workflowStarter.name) {
          case WorkflowStarterName.DEPLOY:
          case WorkflowStarterName.UPDATE: {
            const shouldProceed = await runUpdateConfigureIfNeededAsync({
              projectDir,
              expoConfig,
            });
            if (!shouldProceed) {
              workflowStarter = undefined;
              continue;
            }
            // Need to refetch the Expo config because it may have changed
            expoConfig = (await getDynamicPrivateProjectConfigAsync()).exp;
            break;
          }
          default:
            break;
        }
      }

      const { fileName, filePath } = await chooseFileNameAsync(
        argFileName,
        projectDir,
        workflowStarter
      );

      // Customize the template if needed
      workflowStarter = await customizeTemplateIfNeededAsync(
        workflowStarter,
        projectDir,
        expoConfig
      );

      Log.debug(`Creating workflow file ${fileName} from template ${workflowStarter.name}`);
      const yamlString = [
        workflowStarter.header,
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
      await ensureWorkflowsDirectoryExistsAsync({ projectDir });
      filePath && (await fs.writeFile(filePath, yamlString));
      Log.withTick(`Created ${chalk.bold(filePath)}`);
      Log.addNewLineIfNone();
      Log.log(howToRunWorkflow(fileName, workflowStarter));

      // Next steps
      if (workflowStarter.nextSteps && workflowStarter.nextSteps.length > 0) {
        Log.addNewLineIfNone();
        Log.log('Next steps:');
        Log.addNewLineIfNone();
        Log.log(
          formatFields(
            workflowStarter.nextSteps.map((step: string, index: number) => ({
              label: `${index + 1}.`,
              value: step,
            }))
          )
        );
      }
    } catch (error) {
      logWorkflowValidationErrors(error);
      Log.error('Failed to create workflow file.');
    }
  }
}

async function ensureWorkflowsDirectoryExistsAsync({
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

async function chooseTemplateAsync(): Promise<WorkflowStarter> {
  const workflowStarter = (
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
  return workflowStarter;
}

async function chooseFileNameAsync(
  initialValue: string | undefined,
  projectDir: string,
  workflowStarter: WorkflowStarter
): Promise<{ fileName: string; filePath: string }> {
  let fileName = initialValue;
  let filePath = '';
  while ((fileName?.length ?? 0) === 0) {
    fileName = (
      await promptAsync({
        type: 'text',
        name: 'fileName',
        message: 'What would you like to name your workflow file?',
        initial: workflowStarter.defaultFileName,
      })
    ).fileName;
    if (!fileName) {
      fileName = undefined;
      continue;
    }
    try {
      WorkflowFile.validateYamlExtension(fileName);
    } catch (error) {
      Log.error(error instanceof Error ? error.message : 'Invalid YAML file name extension');
      fileName = undefined;
      continue;
    }
    filePath = path.join(projectDir, '.eas', 'workflows', fileName);
    if (await fsExtra.pathExists(filePath)) {
      Log.error(`Workflow file already exists: ${filePath}`);
      Log.error('Please choose a different file name.');
      Log.newLine();
      fileName = undefined;
    }
  }
  return { fileName: fileName ?? '', filePath };
}
