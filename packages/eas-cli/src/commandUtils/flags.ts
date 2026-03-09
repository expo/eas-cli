import { Flags } from '@oclif/core';
import { boolish } from 'getenv';

export function isNonInteractiveByDefault(): boolean {
  return boolish('CI', false) || !process.stdin.isTTY;
}

export const EasNonInteractiveAndJsonFlags = {
  json: Flags.boolean({
    description:
      'Enable JSON output, non-JSON messages will be printed to stderr. Implies --non-interactive.',
  }),
  'non-interactive': Flags.boolean({
    description: 'Run the command in non-interactive mode.',
    default: () => Promise.resolve(isNonInteractiveByDefault()),
    noCacheDefault: true,
  }),
};

export function resolveNonInteractiveAndJsonFlags(flags: {
  json?: boolean;
  'non-interactive'?: boolean;
}): { json: boolean; nonInteractive: boolean } {
  const json = flags.json ?? false;
  const nonInteractive = flags['non-interactive'] || json;
  return { json, nonInteractive };
}

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
  format: Flags.option({
    description: 'Output format',
    options: ['long', 'short'] as const,
    default: 'short',
  })(),
};

export const EASVariableVisibilityFlag = {
  visibility: Flags.option({
    description: 'Visibility of the variable',
    options: ['plaintext', 'sensitive', 'secret'] as const,
  })(),
};

export type EASEnvironmentVariableScopeFlagValue = 'project' | 'account';

export const EASEnvironmentVariableScopeFlag = {
  scope: Flags.option({
    description: 'Scope for the variable',
    options: ['project', 'account'] as const,
    default: 'project',
  })(),
};

export const EASNonInteractiveFlag = {
  'non-interactive': Flags.boolean({
    description: 'Run the command in non-interactive mode.',
    default: () => Promise.resolve(isNonInteractiveByDefault()),
    noCacheDefault: true,
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
