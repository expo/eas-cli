import chalk from 'chalk';

import { EnvironmentVariableEnvironment } from '../graphql/generated';
import { promptAsync, selectAsync } from '../prompts';

export async function promptVariableEnvironmentAsync(
  nonInteractive: boolean
): Promise<EnvironmentVariableEnvironment> {
  if (nonInteractive) {
    throw new Error('Environment may not be empty.');
  }
  return await selectAsync('Select environment:', [
    { title: 'Development', value: EnvironmentVariableEnvironment.Development },
    { title: 'Preview', value: EnvironmentVariableEnvironment.Preview },
    { title: 'Production', value: EnvironmentVariableEnvironment.Production },
  ]);
}
export async function promptVariableValueAsync({
  nonInteractive,
  required = true,
  initial,
}: {
  nonInteractive: boolean;
  required?: boolean;
  initial?: string | null;
}): Promise<string> {
  if (nonInteractive && required) {
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
    initial: initial ?? '',
    validate: variableValue => {
      if (!required) {
        return true;
      }
      if (!variableValue || variableValue.trim() === '') {
        return "Environment variable value can't be empty";
      }
      return true;
    },
  });

  if (!variableValue && required) {
    throw new Error(
      `Environment variable needs 'value' to be specifed. Run the command again  with ${chalk.bold(
        '--value VARIABLE_VALUE'
      )} flag or provide it interactively to fix the issue.`
    );
  }

  return variableValue;
}

export async function promptVariableNameAsync(nonInteractive: boolean): Promise<string> {
  const validationMessage = 'Variable name may not be empty.';
  if (nonInteractive) {
    throw new Error(validationMessage);
  }

  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: `Variable name:`,
    validate: value => {
      if (!value) {
        return validationMessage;
      }

      if (!value.match(/^\w+$/)) {
        return 'Names may contain only letters, numbers, and underscores.';
      }

      return true;
    },
  });

  if (!name) {
    throw new Error(validationMessage);
  }

  return name;
}
