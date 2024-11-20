import dateFormat from 'dateformat';

import formatFields from './formatFields';
import {
  EnvironmentSecretType,
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../graphql/generated';
import { EnvironmentVariableWithFileContent } from '../graphql/queries/EnvironmentVariablesQuery';

export function isEnvironment(environment: string): environment is EnvironmentVariableEnvironment {
  return Object.values(EnvironmentVariableEnvironment).includes(
    environment as EnvironmentVariableEnvironment
  );
}

export function formatVariableName(variable: EnvironmentVariableFragment): string {
  const name = variable.name;
  const scope = variable.scope === EnvironmentVariableScope.Project ? 'project' : 'shared';
  const environments = variable.environments?.join(', ') ?? '';
  const updatedAt = variable.updatedAt ? new Date(variable.updatedAt).toLocaleString() : '';
  const type = variable.type === EnvironmentSecretType.FileBase64 ? 'file' : 'string';
  const visibility = variable.visibility;
  return `${name} | ${scope} | ${type} | ${visibility} | ${environments} | Updated at: ${updatedAt}`;
}

export function formatVariableValue(variable: EnvironmentVariableWithFileContent): string {
  // TODO: Add Learn more link

  if (variable.value) {
    return variable.value;
  }

  if (variable.valueWithFileContent) {
    return atob(variable.valueWithFileContent);
  }

  if (variable.visibility === EnvironmentVariableVisibility.Sensitive) {
    return '*****(Sensitive)';
  }

  if (variable.visibility === EnvironmentVariableVisibility.Secret) {
    return '*****(Secret)';
  }

  if (variable.type === EnvironmentSecretType.FileBase64) {
    return '(File type variable)';
  }

  return '*****';
}

export async function performForEnvironmentsAsync(
  environments: EnvironmentVariableEnvironment[] | null,
  fun: (environment: EnvironmentVariableEnvironment | undefined) => Promise<any>
): Promise<any[]> {
  const selectedEnvironments = environments ?? [undefined];
  return await Promise.all(selectedEnvironments.map(env => fun(env)));
}

export function formatVariable(variable: EnvironmentVariableWithFileContent): string {
  return formatFields([
    { label: 'Name', value: variable.name },
    { label: 'Value', value: formatVariableValue(variable) },
    {
      label: 'Scope',
      value: variable.scope === EnvironmentVariableScope.Project ? 'Project' : 'Account',
    },
    {
      label: 'Visibility',
      value: variable.visibility ? visibilityToVisibilityName[variable.visibility] : '',
    },
    {
      label: 'Environments',
      value: variable.environments
        ? variable.environments.map(env => env.toLowerCase()).join(', ')
        : '-',
    },
    {
      label: 'Type',
      value: variable.type === EnvironmentSecretType.FileBase64 ? 'File' : 'String',
    },
    { label: 'Created at', value: dateFormat(variable.createdAt, 'mmm dd HH:MM:ss') },
    { label: 'Updated at', value: dateFormat(variable.updatedAt, 'mmm dd HH:MM:ss') },
  ]);
}

const visibilityToVisibilityName: Record<EnvironmentVariableVisibility, string> = {
  [EnvironmentVariableVisibility.Public]: 'Plain text',
  [EnvironmentVariableVisibility.Sensitive]: 'Sensitive',
  [EnvironmentVariableVisibility.Secret]: 'Secret',
};
