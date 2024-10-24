import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { ora } from '../../ora';

export class WorkflowValidate extends EasCommand {
  static override description = 'validate a workflow configuration yaml file';

  static override args = [
    {
      name: 'path',
      description: 'Path to the workflow configuration YAML file (must end with .yml or .yaml)',
      required: true,
    },
  ];

  async runAsync(): Promise<void> {
    const {
      args: { path: filePath },
    } = await this.parse(WorkflowValidate);

    const spinner = ora().start('Validating the workflow YAML file…');

    try {
      await validateYAMLAsync(filePath);
      spinner.succeed('Workflow configuration YAML is valid.');
    } catch (error) {
      spinner.fail('Workflow configuration YAML is not valid.');

      if (error instanceof yaml.YAMLException) {
        Log.error(`YAML syntax error: ${error.message}`);
      } else if (error instanceof Error) {
        Log.error(error.message);
      } else {
        Log.error(`Unexpected error: ${String(error)}`);
      }

      throw error;
    }
  }
}

async function checkIfFileExistsAsync(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`File does not exist: ${filePath}`);
  }
}

function checkIfValidYAMLFileExtension(filePath: string): void {
  const fileExtension = path.extname(filePath).toLowerCase();

  if (fileExtension !== '.yml' && fileExtension !== '.yaml') {
    throw new Error('File must have a .yml or .yaml extension');
  }
}

async function validateYAMLAsync(filePath: string): Promise<void> {
  await checkIfFileExistsAsync(filePath);
  checkIfValidYAMLFileExtension(filePath);

  try {
    const fileContents = await fs.readFile(filePath, 'utf8');
    const parsedYaml = yaml.load(fileContents);

    if (
      parsedYaml === undefined ||
      (typeof parsedYaml === 'object' && Object.keys(parsedYaml!).length === 0)
    ) {
      throw new Error('YAML file is empty or contains only comments.');
    }
  } catch (error) {
    if (error instanceof yaml.YAMLException || error instanceof Error) {
      throw new Error(`YAML parsing error: ${error.message}`);
    } else {
      throw new Error(`YAML parsing error: ${String(error)}`);
    }
  }
}
