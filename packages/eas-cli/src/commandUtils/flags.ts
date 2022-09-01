import { Flags } from '@oclif/core';

export const EasNonInteractiveFlags = {
  nonInteractive: {
    json: Flags.boolean({
      description: 'Enable JSON output, non-JSON messages will be printed to stderr.',
      dependsOn: ['non-interactive'],
    }),
    'non-interactive': Flags.boolean({
      description: 'Run the command in non-interactive mode.',
    }),
  },
  jsonOnly: {
    json: Flags.boolean({
      description: 'Enable JSON output, non-JSON messages will be printed to stderr.',
      dependsOn: ['non-interactive'],
    }),
  },
};
