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
export async function promptVariableValueAsync(nonInteractive: boolean): Promise<string> {
  const validationMessage = 'Variable value may not be empty.';
  if (nonInteractive) {
    throw new Error(validationMessage);
  }

  const { variableValue } = await promptAsync({
    type: 'text',
    name: 'variableValue',
    message: 'Variable value:',
    // eslint-disable-next-line async-protect/async-suffix
    validate: async variableValue => {
      if (!variableValue) {
        return validationMessage;
      }
      return true;
    },
  });

  if (!variableValue) {
    throw new Error(validationMessage);
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
