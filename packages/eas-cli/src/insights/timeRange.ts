import { resolveTimeRange } from '../observe/startAndEndTime';

export const INSIGHTS_DEFAULT_DAYS_BACK = 7;

export function resolveInsightsTimeRange(flags: { days?: number; start?: string; end?: string }): {
  daysBack?: number;
  startTime: string;
  endTime: string;
} {
  const days = flags.days ?? (flags.start ? undefined : INSIGHTS_DEFAULT_DAYS_BACK);
  return resolveTimeRange({ ...flags, days });
}
