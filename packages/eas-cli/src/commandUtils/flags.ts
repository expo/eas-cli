import { Flags } from '@oclif/core';

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
  description: "Environment variable's environment, e.g. 'production', 'preview', 'development'",
};

export const EASEnvironmentFlag = {
  environment: Flags.string({
    description: "Environment variable's environment, e.g. 'production', 'preview', 'development'",
  }),
};

export const EASMultiEnvironmentFlag = {
  environment: Flags.string({
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
  visibility: Flags.enum<'plaintext' | 'sensitive' | 'secret'>({
    description: 'Visibility of the variable',
    options: ['plaintext', 'sensitive', 'secret'],
  }),
};

export type EASEnvironmentVariableScopeFlagValue = 'project' | 'account';

export const EASEnvironmentVariableScopeFlag = {
  scope: Flags.enum<EASEnvironmentVariableScopeFlagValue>({
    description: 'Scope for the variable',
    options: ['project', 'account'],
    default: 'project',
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

export const EasUpdateEnvironmentFlag = {
  environment: Flags.string({
    description:
      'Environment to use for the server-side defined EAS environment variables during command execution, e.g. "production", "preview", "development".',
    required: false,
    default: undefined,
  }),
};

export const EasUpdateEnvironmentRequiredFlag = {
  environment: Flags.string({
    description:
      'Environment to use for the server-side defined EAS environment variables during command execution, e.g. "production", "preview", "development". Required for projects using Expo SDK 55 or greater.',
    required: false,
    default: undefined,
  }),
};
