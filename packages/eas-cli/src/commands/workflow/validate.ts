import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { ora } from '../../ora';

export default class WorkflowValidate extends EasCommand {
  static override description = 'validate a workflow configuration yaml file';

  static override args = [
    {
      name: 'path',
      description: 'Path to the workflow configuration yaml file (must end with .yml or .yaml)',
      required: true,
    },
  ];

  async runAsync(): Promise<void> {
    const {
      args: { path: filePath },
    } = await this.parse(WorkflowValidate);

    const spinner = ora().start('Validating the workflow YAML file…');

    try {
      try {
        await fs.access(filePath);
      } catch {
        throw new Error(`File does not exist: ${filePath}`);
      }

      const fileExtension = path.extname(filePath).toLowerCase();

      if (fileExtension !== '.yml' && fileExtension !== '.yaml') {
        throw new Error('File must have a .yml or .yaml extension');
      }

      const fileContents = await fs.readFile(filePath, 'utf8');

      try {
        const parsedYaml = yaml.load(fileContents);
        if (parsedYaml === undefined) {
          throw new Error('YAML file is empty or contains only comments');
        }
      } catch (error) {
        if (error instanceof yaml.YAMLException) {
          throw new Error(`YAML parsing error: ${error.message}`);
        } else if (error instanceof Error) {
          throw new Error(`YAML parsing error: ${error.message}`);
        } else {
          throw new Error(`YAML parsing error: ${String(error)}`);
        }
      }

      spinner.succeed('Workflow configuration YAML is valid');
    } catch (error) {
      spinner.fail('Workflow configuration YAML is invalid');
      if (error instanceof yaml.YAMLException) {
        Log.error(`YAML parsing error: ${error.message}`);
      }
      throw error;
    }
  }
}
