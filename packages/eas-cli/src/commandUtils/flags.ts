import { Flags } from '@oclif/core';

import { EnvironmentVariableEnvironment, EnvironmentVariableScope } from '../graphql/generated';

async function upperCaseAsync(input: string): Promise<string> {
  return input.toUpperCase();
}

function mapToLowercase<T extends string>(options: T[]): string[] {
  return options.map(option => option.toLowerCase());
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

export const EASEnvironmentFlag = {
  environment: Flags.enum({
    description: "Environment variable's environment",
    parse: upperCaseAsync,
    options: mapToLowercase([
      EnvironmentVariableEnvironment.Development,
      EnvironmentVariableEnvironment.Preview,
      EnvironmentVariableEnvironment.Production,
    ]),
  }),
};

export const EASVariableFormatFlag = {
  format: Flags.enum({
    description: 'Output format',
    options: ['long', 'short'],
    default: 'short',
  }),
};

export const EASVariableVisibilityFlags = {
  sensitive: Flags.boolean({
    description: 'Encrypt variable value at rest',
    default: false,
    exclusive: ['secret', 'public'],
  }),
  secret: Flags.boolean({
    description: 'Encrypt variable value at rest and protect it from being displayed',
    default: false,
    exclusive: ['sensitive', 'public'],
  }),
  public: Flags.boolean({
    description: 'Make variable value public',
    default: false,
    exclusive: ['sensitive', 'secret'],
  }),
};

export const EASVariableScopeFlag = {
  scope: Flags.enum({
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
