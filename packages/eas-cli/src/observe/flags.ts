import { Flags } from '@oclif/core';

import { allowedPlatformFlagValues } from './platforms';

export const ObserveProjectIdFlag = {
  'project-id': Flags.string({
    description: 'EAS project ID (defaults to the project ID of the current directory)',
  }),
};

export const ObservePlatformFlag = {
  platform: Flags.option({
    description: 'Filter by platform',
    options: allowedPlatformFlagValues,
  })(),
};

export const ObserveTimeRangeFlags = {
  start: Flags.string({
    description: 'Start of time range (ISO date)',
    exclusive: ['days'],
  }),
  end: Flags.string({
    description: 'End of time range (ISO date)',
    exclusive: ['days'],
  }),
  days: Flags.integer({
    description: 'Show results from the last N days (mutually exclusive with --start/--end)',
    min: 1,
    exclusive: ['start', 'end'],
  }),
};

export const ObserveAfterFlag = {
  after: Flags.string({
    description:
      'Cursor for pagination. Use the endCursor from a previous query to fetch the next page.',
  }),
};

export const ObserveAppVersionFlag = {
  'app-version': Flags.string({
    description: 'Filter by app version',
  }),
};

export const ObserveUpdateIdFlag = {
  'update-id': Flags.string({
    description: 'Filter by EAS update ID',
  }),
};
