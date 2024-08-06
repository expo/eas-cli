import dateFormat from 'dateformat';

import formatFields from './formatFields';
import { EnvironmentVariableFragment } from '../graphql/generated';

export function formatVariable(variable: EnvironmentVariableFragment): string {
  return formatFields([
    { label: 'ID', value: variable.id },
    { label: 'Name', value: variable.name },
    { label: 'Value', value: variable.value || '' },
    { label: 'Scope', value: variable.scope },
    { label: 'Created at', value: dateFormat(variable.createdAt, 'mmm dd HH:MM:ss') },
  ]);
}
