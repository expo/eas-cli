import { Flags } from '@oclif/core';

<<<<<<< HEAD
import { EnvironmentVariableEnvironment, EnvironmentVariableScope } from '../graphql/generated';

async function upperCaseAsync(input: string): Promise<string> {
  return input.toUpperCase();
}

function mapToLowercase<T extends string>(options: T[]): string[] {
  return options.map(option => option.toLowerCase());
}

||||||| parent of 2b270de0 ([ENG-11913] Implement `eas env` commands)
=======
import { EnvironmentVariableEnvironment, EnvironmentVariableScope } from '../graphql/generated';

>>>>>>> 2b270de0 ([ENG-11913] Implement `eas env` commands)
export const EasNonInteractiveAndJsonFlags = {
  json: Flags.boolean({
    description: 'Enable JSON output, non-JSON messages will be printed to stderr.',
    dependsOn: ['non-interactive'],
  }),
  'non-interactive': Flags.boolean({
    description: 'Run the command in non-interactive mode.',
  }),
};

<<<<<<< HEAD
export const EASEnvironmentFlag = {
  environment: Flags.enum({
    description: 'Environment to create the secret in',
    parse: upperCaseAsync,
    options: mapToLowercase([
      EnvironmentVariableEnvironment.Development,
      EnvironmentVariableEnvironment.Preview,
      EnvironmentVariableEnvironment.Production,
    ]),
  }),
};

export const EASVariableFormatFlag = {
  format: Flags.string({
    description: 'Output format',
    options: ['long', 'short'],
    default: 'short',
  }),
};

export const EASVariableSensitiveFlag = {
  sensitive: Flags.boolean({
    description: 'Encrypt variable value at rest',
    default: false,
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

||||||| parent of 2b270de0 ([ENG-11913] Implement `eas env` commands)
=======
async function upperCaseAsync(input: string): Promise<string> {
  return input.toUpperCase();
}

export const EASEnvironmentFlag = {
  environment: Flags.enum({
    description: 'Environment to create the secret in',
    parse: upperCaseAsync,
    options: [
      EnvironmentVariableEnvironment.Development,
      EnvironmentVariableEnvironment.Preview,
      EnvironmentVariableEnvironment.Production,
    ].map(env => env.toLowerCase()),
  }),
};

export const EASVariableFormatFlag = {
  format: Flags.string({
    description: 'Output format',
    options: ['long', 'short'],
    default: 'short',
  }),
};

export const EASVariableSensitiveFlag = {
  sensitive: Flags.boolean({
    description: 'Encrypt variable value at rest',
    default: false,
  }),
};

export const EASVariableScopeFlag = {
  scope: Flags.enum({
    description: 'Scope for the variable',
    options: [EnvironmentVariableScope.Shared, EnvironmentVariableScope.Project],
    default: EnvironmentVariableScope.Project,
  }),
};

>>>>>>> 2b270de0 ([ENG-11913] Implement `eas env` commands)
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
