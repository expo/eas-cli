import { Flags } from '@oclif/core';

import { resolveTimeRange } from '../observe/startAndEndTime';

export const INSIGHTS_DEFAULT_DAYS_BACK = 7;

export const InsightsTimeRangeFlags = {
  days: Flags.integer({
    description: `Show insights from the last N days (default ${INSIGHTS_DEFAULT_DAYS_BACK}, mutually exclusive with --start/--end).`,
    min: 1,
    exclusive: ['start', 'end'],
  }),
  start: Flags.string({
    description: 'Start of insights time range (ISO date).',
    exclusive: ['days'],
  }),
  end: Flags.string({
    description: 'End of insights time range (ISO date).',
    exclusive: ['days'],
  }),
};

export function resolveInsightsTimeRange(flags: { days?: number; start?: string; end?: string }): {
  daysBack?: number;
  startTime: string;
  endTime: string;
} {
  const days = flags.days ?? (flags.start ? undefined : INSIGHTS_DEFAULT_DAYS_BACK);
  return resolveTimeRange({ ...flags, days });
}
