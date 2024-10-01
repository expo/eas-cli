import { Flags } from '@oclif/core';

import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../graphql/generated';

// NOTE: not exactly true, but, provided mapToLowercase and upperCaseAsync
// are used in tandem, it saves on unnecessary typying in commands
async function upperCaseAsync<T>(input: string): Promise<T> {
  return input.toUpperCase() as T;
}

function mapToLowercase<T extends string>(options: T[]): T[] {
  return options.map(option => option.toLowerCase()) as T[];
}

export const EasNonInteractiveAndJsonFlags = {
  json: Flags.boolean({
    description: 'Enable JSON output, non-JSON messages will be printed to stderr.',
    dependsOn: ['non-interactive'],
  }),
  'non-interactive': Flags.boolean({
    description: 'Run the command in non-interactive mode.',
  }),
};

export const EasEnvironmentFlagParameters = {
  description: "Environment variable's environment",
  parse: upperCaseAsync,
  options: mapToLowercase([
    EnvironmentVariableEnvironment.Development,
    EnvironmentVariableEnvironment.Preview,
    EnvironmentVariableEnvironment.Production,
  ]),
};

export const EASEnvironmentFlag = {
  environment: Flags.enum<EnvironmentVariableEnvironment>(EasEnvironmentFlagParameters),
};

export const EASMultiEnvironmentFlag = {
  environment: Flags.enum<EnvironmentVariableEnvironment>({
    ...EasEnvironmentFlagParameters,
    multiple: true,
  }),
};

export const EASVariableFormatFlag = {
  format: Flags.enum({
    description: 'Output format',
    options: ['long', 'short'],
    default: 'short',
  }),
};

export const EASVariableVisibilityFlag = {
  visibility: Flags.enum<EnvironmentVariableVisibility>({
    description: 'Visibility of the variable',
    options: mapToLowercase([
      EnvironmentVariableVisibility.Secret,
      EnvironmentVariableVisibility.Sensitive,
      EnvironmentVariableVisibility.Public,
    ]),
    parse: upperCaseAsync,
  }),
};

export const EASVariableScopeFlag = {
  scope: Flags.enum<EnvironmentVariableScope>({
    description: 'Scope for the variable',
    options: mapToLowercase([EnvironmentVariableScope.Shared, EnvironmentVariableScope.Project]),
    parse: upperCaseAsync,
    default: EnvironmentVariableScope.Project,
  }),
};

export const EASNonInteractiveFlag = {
  'non-interactive': Flags.boolean({
    description: 'Run the command in non-interactive mode.',
  }),
};

export const EasJsonOnlyFlag = {
  json: Flags.boolean({
    description: 'Enable JSON output, non-JSON messages will be printed to stderr.',
  }),
};
