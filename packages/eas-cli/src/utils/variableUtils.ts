import dateFormat from 'dateformat';

import formatFields from './formatFields';
import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
  EnvironmentVariableScope,
} from '../graphql/generated';

export function formatVariableName(variable: EnvironmentVariableFragment): string {
  const name = variable.name;
  const scope = variable.scope === EnvironmentVariableScope.Project ? 'project' : 'shared';
  const environments = variable.environments?.join(', ') ?? '';
  const updatedAt = variable.updatedAt ? new Date(variable.updatedAt).toLocaleString() : '';
  return `${name} | ${scope} | ${environments} | Updated at: ${updatedAt}`;
}

export async function performForEnvironmentsAsync(
  environments: EnvironmentVariableEnvironment[] | null,
  fun: (environment: EnvironmentVariableEnvironment | undefined) => Promise<any>
): Promise<any[]> {
  const selectedEnvironments = environments ?? [undefined];
  return await Promise.all(selectedEnvironments.map(env => fun(env)));
}

export function formatVariable(variable: EnvironmentVariableFragment): string {
  return formatFields([
    { label: 'ID', value: variable.id },
    { label: 'Name', value: variable.name },
    { label: 'Value', value: variable.value ?? '(secret)' },
    { label: 'Scope', value: variable.scope },
    { label: 'Created at', value: dateFormat(variable.createdAt, 'mmm dd HH:MM:ss') },
    { label: 'Updated at', value: dateFormat(variable.updatedAt, 'mmm dd HH:MM:ss') },
  ]);
}
