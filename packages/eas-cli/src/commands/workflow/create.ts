import { ExpoConfig } from '@expo/config';
import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import nullthrows from 'nullthrows';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import {
  configureEasBuildIfNeededAsync,
  configureEasUpdateIfNeededAsync,
} from '../../commandUtils/workflow/buildProfileUtils';
import {
  PLACEHOLDER_WORKFLOW_CONTENTS,
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
import Log, { link } from '../../log';
import { getPrivateExpoConfigAsync } from '../../project/expoConfig';
import { initializeWithoutExplicitIDAsync } from '../../project/projectInitialization';
import { promptAsync } from '../../prompts';
import formatFields from '../../utils/formatFields';
import { Client } from '../../vcs/vcs';

export class WorkflowCreate extends EasCommand {
  static override description = 'create a new workflow configuration YAML file';

  static override args = {
    name: Args.string({
      description:
        'Name of the workflow file. When provided without --template, a placeholder workflow is created.',
      required: false,
    }),
  };

  static override flags = {
    template: Flags.option({
      description: 'Template to use for the workflow file',
      options: [
        WorkflowStarterName.BUILD,
        WorkflowStarterName.UPDATE,
        WorkflowStarterName.DEPLOY,
        WorkflowStarterName.CUSTOM,
      ] as const,
    })(),
    'skip-validation': Flags.boolean({
      description: 'If set, the workflow file will not be validated before being created',
      default: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const {
      args: { name: argFileName },
      flags,
    } = await this.parse(WorkflowCreate);

    try {
      const {
        getDynamicPrivateProjectConfigAsync,
        loggedIn: { actor, graphqlClient },
        projectDir,
        vcsClient,
      } = await this.getContextAsync(WorkflowCreate, {
        nonInteractive: false,
        withServerSideEnvironment: null,
      });

      if (argFileName && !flags.template) {
        await createPlaceholderWorkflowFileAsync({ argFileName, projectDir });
        return;
      }

      const privateExpoConfig = await getPrivateExpoConfigAsync(projectDir);
      if (!privateExpoConfig.extra?.eas?.projectId) {
        await initializeWithoutExplicitIDAsync(graphqlClient, actor, projectDir, {
          force: false,
          nonInteractive: false,
        });
      }

      const { exp: originalExpoConfig, projectId } = await getDynamicPrivateProjectConfigAsync();

      let workflowStarter = flags.template
        ? nullthrows(workflowStarters.find(s => s.name === flags.template))
        : await chooseTemplateAsync();

      const expoConfig = await configureProjectForStarterAsync({
        workflowStarter,
        projectDir,
        expoConfig: originalExpoConfig,
        projectId,
        vcsClient,
        getDynamicPrivateProjectConfigAsync,
      });

      const { fileName, filePath } = await resolveTemplateFileNameAsync({
        argFileName,
        projectDir,
        workflowStarter,
      });

      workflowStarter = await customizeTemplateIfNeededAsync({
        workflowStarter,
        projectDir,
        expoConfig,
        graphqlClient,
        projectId,
        vcsClient,
      });

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
      await fs.writeFile(filePath, yamlString);
      Log.withTick(`Created ${chalk.bold(filePath)}`);

      logNextSteps([
        ...(workflowStarter.nextSteps ?? []).map(
          step => `${chalk.yellow('[Action required]')} ${step}`
        ),
        howToRunWorkflow(fileName, workflowStarter),
      ]);
    } catch (error) {
      logWorkflowValidationErrors(error);
      Log.error('Failed to create workflow file.');
    }
  }
}

async function configureProjectForStarterAsync({
  workflowStarter,
  projectDir,
  expoConfig,
  projectId,
  vcsClient,
  getDynamicPrivateProjectConfigAsync,
}: {
  workflowStarter: WorkflowStarter;
  projectDir: string;
  expoConfig: ExpoConfig;
  projectId: string;
  vcsClient: Client;
  getDynamicPrivateProjectConfigAsync: () => Promise<{ exp: ExpoConfig }>;
}): Promise<ExpoConfig> {
  switch (workflowStarter.name) {
    case WorkflowStarterName.BUILD:
    case WorkflowStarterName.DEPLOY:
    case WorkflowStarterName.UPDATE:
      await configureEasBuildIfNeededAsync({ projectDir, expoConfig, vcsClient });
      break;
    default:
      break;
  }
  switch (workflowStarter.name) {
    case WorkflowStarterName.DEPLOY:
    case WorkflowStarterName.UPDATE:
      await configureEasUpdateIfNeededAsync({ projectDir, expoConfig, projectId, vcsClient });
      break;
    default:
      break;
  }
  return (await getDynamicPrivateProjectConfigAsync()).exp;
}

function logNextSteps(steps: string[]): void {
  Log.addNewLineIfNone();
  Log.log('➡️ Next steps:');
  Log.addNewLineIfNone();
  Log.log(
    formatFields(
      steps.map((step, index) => ({
        label: `${index + 1}.`,
        value: step,
      }))
    )
  );
}

async function createPlaceholderWorkflowFileAsync({
  argFileName,
  projectDir,
}: {
  argFileName: string;
  projectDir: string;
}): Promise<void> {
  const fileName = ensureYamlExtension(argFileName);
  const filePath = path.join(projectDir, '.eas', 'workflows', fileName);
  if (await fsExtra.pathExists(filePath)) {
    Log.error(`Workflow file already exists: ${chalk.bold(filePath)}`);
    return;
  }
  await ensureWorkflowsDirectoryExistsAsync({ projectDir });
  await fs.writeFile(filePath, PLACEHOLDER_WORKFLOW_CONTENTS);
  Log.withTick(`Created ${chalk.bold(filePath)}`);
  logNextSteps([
    `Fill in the "name", "on", and "jobs" fields. Learn more: ${link(
      'https://docs.expo.dev/eas/workflows/syntax/'
    )}`,
    `Run this workflow with ${chalk.bold(`eas workflow:run ${fileName}`)}`,
  ]);
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

async function resolveTemplateFileNameAsync({
  argFileName,
  projectDir,
  workflowStarter,
}: {
  argFileName: string | undefined;
  projectDir: string;
  workflowStarter: WorkflowStarter;
}): Promise<{ fileName: string; filePath: string }> {
  const baseName = argFileName ? ensureYamlExtension(argFileName) : workflowStarter.defaultFileName;
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);

  let fileName = baseName;
  let filePath = path.join(projectDir, '.eas', 'workflows', fileName);
  let counter = 1;
  while (await fsExtra.pathExists(filePath)) {
    fileName = `${stem}-${counter}${ext}`;
    filePath = path.join(projectDir, '.eas', 'workflows', fileName);
    counter++;
  }
  return { fileName, filePath };
}

function ensureYamlExtension(name: string): string {
  const ext = path.extname(name);
  if (!ext) {
    return `${name}.yml`;
  }
  const lowerExt = ext.toLowerCase();
  if (lowerExt === '.yml' || lowerExt === '.yaml') {
    return name;
  }
  throw new Error(`Workflow file name must end with .yml or .yaml, but got "${name}".`);
}
