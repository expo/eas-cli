import { ExpoConfig } from '@expo/config';
import { Args, Flags } from '@oclif/core';
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
      options: ['build', 'update', 'deploy', 'custom'] as const,
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

      // If a file name is provided without a template, create a placeholder workflow and exit.
      if (argFileName && !flags.template) {
        await createPlaceholderWorkflowFileAsync({ argFileName, projectDir });
        return;
      }

      // If the project isn't linked to an EAS project yet, run the same create-or-link flow as
      // `eas init` (which lets the user pick the owning account, including organizations). Without
      // this, an unconfigured org-owned project would silently default to the personal account.
      const privateExpoConfig = await getPrivateExpoConfigAsync(projectDir);
      if (!privateExpoConfig.extra?.eas?.projectId) {
        await initializeWithoutExplicitIDAsync(graphqlClient, actor, projectDir, {
          force: false,
          nonInteractive: false,
        });
      }

      const { exp: originalExpoConfig, projectId } = await getDynamicPrivateProjectConfigAsync();
      let expoConfig = originalExpoConfig;

      let workflowStarter: WorkflowStarter | undefined;
      if (flags.template) {
        const starter = workflowStarters.find(
          starter => starter.name === (flags.template as WorkflowStarterName)
        );
        if (!starter) {
          throw new Error(`Unknown workflow template: ${flags.template}`);
        }
        const result = await configureProjectForStarterAsync({
          workflowStarter: starter,
          projectDir,
          expoConfig,
          getDynamicPrivateProjectConfigAsync,
        });
        if (!result.proceed) {
          Log.log('Aborted workflow creation.');
          return;
        }
        expoConfig = result.expoConfig;
        workflowStarter = starter;
      } else {
        while (!workflowStarter) {
          const starter = await chooseTemplateAsync();
          const result = await configureProjectForStarterAsync({
            workflowStarter: starter,
            projectDir,
            expoConfig,
            getDynamicPrivateProjectConfigAsync,
          });
          if (!result.proceed) {
            continue;
          }
          expoConfig = result.expoConfig;
          workflowStarter = starter;
        }
      }

      const { fileName, filePath } = await resolveTemplateFileNameAsync({
        argFileName,
        projectDir,
        workflowStarter,
      });

      // Customize the template if needed
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

      logNextSteps({ workflowStarter, fileName });
    } catch (error) {
      logWorkflowValidationErrors(error);
      Log.error('Failed to create workflow file.');
    }
  }
}

/**
 * Runs the EAS Build/Update configuration steps required for the given template.
 * Returns whether to proceed with workflow creation, along with a freshly-read Expo config.
 */
async function configureProjectForStarterAsync({
  workflowStarter,
  projectDir,
  expoConfig,
  getDynamicPrivateProjectConfigAsync,
}: {
  workflowStarter: WorkflowStarter;
  projectDir: string;
  expoConfig: ExpoConfig;
  getDynamicPrivateProjectConfigAsync: () => Promise<{ exp: ExpoConfig }>;
}): Promise<{ proceed: boolean; expoConfig: ExpoConfig }> {
  switch (workflowStarter.name) {
    case WorkflowStarterName.BUILD:
    case WorkflowStarterName.DEPLOY:
    case WorkflowStarterName.UPDATE: {
      const shouldProceed = await runBuildConfigureIfNeededAsync({ projectDir, expoConfig });
      if (!shouldProceed) {
        return { proceed: false, expoConfig };
      }
      break;
    }
    default:
      break;
  }
  switch (workflowStarter.name) {
    case WorkflowStarterName.DEPLOY:
    case WorkflowStarterName.UPDATE: {
      const shouldProceed = await runUpdateConfigureIfNeededAsync({ projectDir, expoConfig });
      if (!shouldProceed) {
        return { proceed: false, expoConfig };
      }
      break;
    }
    default:
      break;
  }
  // Re-read the Expo config because the configuration steps above may have changed it.
  const refreshedExpoConfig = (await getDynamicPrivateProjectConfigAsync()).exp;
  return { proceed: true, expoConfig: refreshedExpoConfig };
}

function logNextSteps({
  workflowStarter,
  fileName,
}: {
  workflowStarter: WorkflowStarter;
  fileName: string;
}): void {
  const actionRequiredSteps = (workflowStarter.nextSteps ?? []).map(
    step => `${chalk.yellow('[Action required]')} ${step}`
  );
  const steps = [...actionRequiredSteps, howToRunWorkflow(fileName, workflowStarter)];
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
  Log.addNewLineIfNone();
  Log.log('➡️ Next steps:');
  Log.addNewLineIfNone();
  Log.log(
    formatFields([
      {
        label: '1.',
        value: `Fill in the "name", "on", and "jobs" fields. Learn more: ${link(
          'https://docs.expo.dev/eas/workflows/syntax/'
        )}`,
      },
      {
        label: '2.',
        value: `Run this workflow with ${chalk.bold(`eas workflow:run ${fileName}`)}`,
      },
    ])
  );
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

/**
 * Resolves the file name for a template-based workflow. When the user provides a file name it is
 * used (with a .yml/.yaml extension), otherwise the template's default file name is used. A numeric
 * suffix is appended to avoid overwriting an existing file.
 */
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

/**
 * Ensures a file name ends with a .yml or .yaml extension. If the file name has no extension, .yml
 * is appended. If it has a non-YAML extension, an error is thrown.
 */
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
