import chalk from 'chalk';

import { EnvironmentVariableEnvironment } from '../graphql/generated';
import { promptAsync, selectAsync } from '../prompts';

export async function promptVariableEnvironmentAsync(
  nonInteractive: boolean
): Promise<EnvironmentVariableEnvironment> {
  if (nonInteractive) {
    throw new Error(
      `Environment value needs to be specified when running in non-interactive mode. Run the command with ${chalk.bold(
        '--environment development|preview|production'
      )} flag to fix the issue`
    );
  }
  return await selectAsync('Select environment:', [
    { title: 'Development', value: EnvironmentVariableEnvironment.Development },
    { title: 'Preview', value: EnvironmentVariableEnvironment.Preview },
    { title: 'Production', value: EnvironmentVariableEnvironment.Production },
  ]);
}
export async function promptVariableValueAsync(nonInteractive: boolean): Promise<string> {
  if (nonInteractive) {
    throw new Error(
      `Environment variable needs 'value' to be specified when running in non-interactive mode. Run the command with ${chalk.bold(
        '--value VARIABLE_VALUE'
      )} flag to fix the issue`
    );
  }

  const { variableValue } = await promptAsync({
    type: 'text',
    name: 'variableValue',
    message: 'Variable value:',
    validate: variableValue => {
      if (!variableValue || variableValue.trim() === '') {
        return "Environment variable value can't be empty";
      }
      return true;
    },
  });

  if (!variableValue) {
    throw new Error(
      `Environment variable needs 'value' to be specifed. Run the command again  with ${chalk.bold(
        '--value VARIABLE_VALUE'
      )} flag or provide it interactively to fix the issue.`
    );
  }

  return variableValue;
}
export async function promptVariableNameAsync(nonInteractive: boolean): Promise<string> {
  if (nonInteractive) {
    throw new Error(
      `Environment variable needs 'name' to be specified when running in non-interactive mode. Run the command with ${chalk.bold(
        '--name VARIABLE_NAME'
      )} flag to fix the issue`
    );
  }

  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: `Variable name:`,
    validate: value => {
      if (!value) {
        return "Environment variable name can't be empty";
      }

      if (!value.match(/^\w+$/)) {
        return 'Environment variable names may contain only letters, numbers, and underscores.';
      }

      return true;
    },
  });

  if (!name) {
    throw new Error(
      `Environment variable needs 'name' to be specifed. Run the command again  with ${chalk.bold(
        '--name VARIABLE_NAME'
      )} flag or provide it interactively to fix the issue.`
    );
  }

  return name;
}
