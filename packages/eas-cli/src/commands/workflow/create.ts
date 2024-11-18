import chalk from 'chalk';
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import path from 'path';
import prompts from 'prompts';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import Log from '../../log';
import { WorkflowFile } from '../../utils/workflowFile';

const DEFAULT_WORKFLOW_NAME = 'workflow.yml';
const HELLO_WORLD_TEMPLATE = `name: Hello World

on:
  push:
    branches: ['*']

jobs:
  hello_world:
    steps:
      - uses: eas/checkout
      - run: echo "Hello, World"
`;

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
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const {
      args: { name: argFileName },
      flags,
    } = await this.parse(WorkflowCreate);

    const { projectDir } = await this.getContextAsync(WorkflowCreate, {
      nonInteractive: flags['non-interactive'],
    });

    let fileName = argFileName;

    if (!fileName) {
      const response = await prompts({
        type: 'text',
        name: 'fileName',
        message: 'What would you like to name your workflow file?',
        initial: DEFAULT_WORKFLOW_NAME,
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

    try {
      await this.ensureWorkflowsDirectoryExistsAsync({ projectDir });
      await this.createWorkflowFileAsync({ fileName, projectDir });
    } catch (error) {
      Log.error('Failed to create workflow file.');
      throw error;
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
  }: {
    fileName: string;
    projectDir: string;
  }): Promise<void> {
    WorkflowFile.validateYamlExtension(fileName);

    const filePath = path.join(projectDir, '.eas', 'workflows', fileName);

    if (await fsExtra.pathExists(filePath)) {
      throw new Error(`Workflow file already exists: ${filePath}`);
    }

    await fs.writeFile(filePath, HELLO_WORLD_TEMPLATE);
    Log.withTick(`Created ${chalk.bold(filePath)}`);
  }
}
