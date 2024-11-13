import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import prompts from 'prompts';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';

const WORKFLOWS_DIR = path.join('.eas', 'workflows');
const DEFAULT_WORKFLOW_NAME = 'workflow.yml';
const HELLO_WORLD_TEMPLATE = `name: Hello World

on:
  push:
    branches: ['*']

jobs:
  Hello World:
    steps:
      - run: echo "Hello, World"
`;

export class WorkflowCreate extends EasCommand {
  static override hidden = true;
  static override description = 'create a new workflow configuration YAML file';

  static override args = [
    {
      name: 'name',
      description: 'Name of the workflow file (must end with .yml or .yaml)',
      required: false,
    },
  ];
  static override contextDefinition = {
    ...this.ContextOptions.ProjectDir,
  }
  async runAsync(): Promise<void> {
    const {
      args: { name: argFileName },
    } = await this.parse(WorkflowCreate);

    let fileName = argFileName;

    if (!fileName) {
      const response = await prompts({
        type: 'text',
        name: 'fileName',
        message: 'What would you like to name your workflow file?',
        initial: DEFAULT_WORKFLOW_NAME,
        validate: value => {
          try {
            this.validateYamlExtension(value);
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
      await this.ensureWorkflowsDirectoryExistsAsync();
      await this.createWorkflowFileAsync(fileName);
      Log.withTick(`Created ${chalk.bold(path.join(WORKFLOWS_DIR, fileName))}`);
    } catch (error) {
      Log.error('Failed to create workflow file.');
      throw error;
    }
  }

  private validateYamlExtension(fileName: string): void {
    const fileExtension = path.extname(fileName).toLowerCase();
    if (fileExtension !== '.yml' && fileExtension !== '.yaml') {
      throw new Error('File must have a .yml or .yaml extension');
    }
  }

  private async ensureWorkflowsDirectoryExistsAsync(): Promise<void> {
    try {
      await fs.access(WORKFLOWS_DIR);
    } catch {
      await fs.mkdir(WORKFLOWS_DIR, { recursive: true });
      Log.withTick(`Created directory ${chalk.bold(WORKFLOWS_DIR)}`);
    }
  }

  private async createWorkflowFileAsync(fileName: string): Promise<void> {
    this.validateYamlExtension(fileName);

    const filePath = path.join(WORKFLOWS_DIR, fileName);

    try {
      await fs.access(filePath);
      throw new Error(`Workflow file already exists: ${filePath}`);
    } catch (error) {
      if ((error as any)?.code === 'ENOENT') {
        await fs.writeFile(filePath, HELLO_WORLD_TEMPLATE);
      } else {
        throw error;
      }
    }
  }
}
