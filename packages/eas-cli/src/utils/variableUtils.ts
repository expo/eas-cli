import dateFormat from 'dateformat';

import formatFields from './formatFields';
import { EnvironmentVariableEnvironment, EnvironmentVariableFragment } from '../graphql/generated';

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
