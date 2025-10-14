import chalk from 'chalk';

import { DefaultEnvironment } from '../build/utils/environment';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EnvironmentSecretType, EnvironmentVariableVisibility } from '../graphql/generated';
import { EnvironmentVariablesQuery } from '../graphql/queries/EnvironmentVariablesQuery';
import { RequestedPlatform } from '../platform';
import { promptAsync, selectAsync } from '../prompts';

const DEFAULT_ENVIRONMENTS = Object.values(DefaultEnvironment);

export async function getProjectEnvironmentVariableEnvironmentsAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string
): Promise<string[]> {
  try {
    const environments = await EnvironmentVariablesQuery.environmentVariableEnvironmentsAsync(
      graphqlClient,
      projectId
    );
    return environments;
  } catch {
    throw new Error('Failed to fetch available environments');
  }
}

const CUSTOM_ENVIRONMENT_VALUE = '~~CUSTOM~~';

export async function promptVariableTypeAsync(
  nonInteractive: boolean,
  initialType?: EnvironmentSecretType
): Promise<EnvironmentSecretType> {
  if (nonInteractive) {
    throw new Error('The `--type` flag must be set when running in `--non-interactive` mode.');
  }

  const options = [
    {
      title: 'String',
      value: EnvironmentSecretType.String,
    },
    {
      title: 'File',
      value: EnvironmentSecretType.FileBase64,
    },
  ];

  return await selectAsync('Select the type of variable', options, {
    initial: initialType,
  });
}

export function parseVisibility(
  stringVisibility: 'plaintext' | 'sensitive' | 'secret'
): EnvironmentVariableVisibility {
  switch (stringVisibility) {
    case 'plaintext':
      return EnvironmentVariableVisibility.Public;
    case 'sensitive':
      return EnvironmentVariableVisibility.Sensitive;
    case 'secret':
      return EnvironmentVariableVisibility.Secret;
    default:
      throw new Error(`Invalid visibility: ${stringVisibility}`);
  }
}

async function promptCustomEnvironmentAsync(): Promise<string> {
  const { customEnvironment } = await promptAsync({
    type: 'text',
    name: 'customEnvironment',
    message: 'Enter custom environment name:',
    validate: (value: string) => {
      if (!value || value.trim() === '') {
        return 'Environment name cannot be empty';
      }
      if (!value.match(/^[a-zA-Z0-9_-]+$/)) {
        return 'Environment name may only contain letters, numbers, underscores, and hyphens';
      }
      return true;
    },
  });
  return customEnvironment;
}

export async function promptVariableVisibilityAsync(
  nonInteractive: boolean,
  selectedVisibility?: EnvironmentVariableVisibility | null
): Promise<EnvironmentVariableVisibility> {
  if (nonInteractive) {
    throw new Error(
      'The `--visibility` flag must be set when running in `--non-interactive` mode.'
    );
  }
  return await selectAsync('Select visibility:', [
    {
      title: 'Plain text',
      value: EnvironmentVariableVisibility.Public,
      selected: selectedVisibility === EnvironmentVariableVisibility.Public,
    },
    {
      title: 'Sensitive',
      value: EnvironmentVariableVisibility.Sensitive,
      selected: selectedVisibility === EnvironmentVariableVisibility.Sensitive,
    },
    {
      title: 'Secret',
      value: EnvironmentVariableVisibility.Secret,
      selected: selectedVisibility === EnvironmentVariableVisibility.Secret,
    },
  ]);
}

type EnvironmentPromptArgs = {
  nonInteractive: boolean;
  selectedEnvironments?: string[];
  graphqlClient?: ExpoGraphqlClient;
  projectId?: string;
  canEnterCustomEnvironment?: boolean;
};

export function promptVariableEnvironmentAsync(
  input: EnvironmentPromptArgs & { multiple: true }
): Promise<string[]>;
export function promptVariableEnvironmentAsync(
  input: EnvironmentPromptArgs & { multiple?: false }
): Promise<string>;

export async function promptVariableEnvironmentAsync({
  nonInteractive,
  selectedEnvironments,
  multiple = false,
  canEnterCustomEnvironment = false,
  graphqlClient,
  projectId,
}: EnvironmentPromptArgs & { multiple?: boolean }): Promise<string[] | string> {
  if (nonInteractive) {
    throw new Error(
      'The `--environment` flag must be set when running in `--non-interactive` mode.'
    );
  }

  let allEnvironments: string[] = DEFAULT_ENVIRONMENTS;
  if (graphqlClient && projectId) {
    const projectEnvironments = await getProjectEnvironmentVariableEnvironmentsAsync(
      graphqlClient,
      projectId
    );
    allEnvironments = [...new Set([...DEFAULT_ENVIRONMENTS, ...projectEnvironments])];
  }

  if (!multiple) {
    const choices = allEnvironments.map(environment => ({
      title: environment,
      value: environment,
    }));

    if (canEnterCustomEnvironment) {
      choices.push({
        title: 'Other (enter custom environment)',
        value: CUSTOM_ENVIRONMENT_VALUE,
      });
    }

    const selectedEnvironment = await selectAsync('Select environment:', choices);

    if (selectedEnvironment === CUSTOM_ENVIRONMENT_VALUE) {
      return await promptCustomEnvironmentAsync();
    }

    return selectedEnvironment;
  }

  const choices = allEnvironments.map(environment => ({
    title: environment,
    value: environment,
    selected: selectedEnvironments?.includes(environment),
  }));

  if (canEnterCustomEnvironment) {
    choices.push({
      title: 'Other (enter custom environment)',
      value: CUSTOM_ENVIRONMENT_VALUE,
      selected: false,
    });
  }

  const { environments } = await promptAsync({
    message: 'Select environment:',
    name: 'environments',
    type: 'multiselect',
    choices,
  });

  if (environments?.includes(CUSTOM_ENVIRONMENT_VALUE)) {
    const customEnvironment = await promptCustomEnvironmentAsync();
    const filteredEnvironments = environments.filter(
      (env: string) => env !== CUSTOM_ENVIRONMENT_VALUE
    );
    return [...filteredEnvironments, customEnvironment];
  }

  return environments;
}

export async function promptVariableValueAsync({
  nonInteractive,
  required = true,
  hidden = false,
  filePath = false,
  initial,
}: {
  nonInteractive: boolean;
  required?: boolean;
  initial?: string | null;
  filePath?: boolean;
  hidden?: boolean;
}): Promise<string> {
  if (nonInteractive && required) {
    throw new Error(
      `Environment variable needs 'value' to be specified when running in non-interactive mode. Run the command with ${chalk.bold(
        '--value VARIABLE_VALUE'
      )} flag to fix the issue`
    );
  }

  const { variableValue } = await promptAsync({
    type: hidden && !filePath ? 'password' : 'text',
    name: 'variableValue',
    message: filePath ? 'File path:' : 'Variable value:',
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

export async function promptVariableNameAsync(
  nonInteractive: boolean,
  initialValue?: string
): Promise<string> {
  const validationMessage = 'Variable name may not be empty.';
  if (nonInteractive) {
    throw new Error(validationMessage);
  }

  const { name } = await promptAsync({
    type: 'text',
    name: 'name',
    message: `Variable name:`,
    initial: initialValue,
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

export async function promptPlatformAsync({
  message,
}: {
  message: string;
}): Promise<RequestedPlatform> {
  const { platform } = await promptAsync({
    type: 'select',
    message,
    name: 'platform',
    choices: [
      {
        title: 'All',
        value: RequestedPlatform.All,
      },
      {
        title: 'iOS',
        value: RequestedPlatform.Ios,
      },
      {
        title: 'Android',
        value: RequestedPlatform.Android,
      },
    ],
  });
  return platform;
}
