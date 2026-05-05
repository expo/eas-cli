import { validateDateFlag } from './fetchMetrics';

export const DEFAULT_DAYS_BACK = 60;

export function startAndEndTime({
  daysBack,
  start,
  end,
}: {
  daysBack?: number;
  start?: string;
  end?: string;
}) {
  let startTime: string;
  let endTime: string;

  if (daysBack) {
    endTime = new Date().toISOString();
    startTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  } else {
    endTime = end ?? new Date().toISOString();
    startTime =
      start ?? new Date(Date.now() - DEFAULT_DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
  }
  return { startTime, endTime };
}

export function resolveTimeRange(flags: { days?: number; start?: string; end?: string }): {
  daysBack?: number;
  startTime: string;
  endTime: string;
} {
  if (flags.start) {
    validateDateFlag(flags.start, '--start');
  }
  if (flags.end) {
    validateDateFlag(flags.end, '--end');
  }

  const daysBack = flags.days ?? (flags.start ? undefined : DEFAULT_DAYS_BACK);
  const { startTime, endTime } = startAndEndTime({
    daysBack,
    start: flags.start,
    end: flags.end,
  });

  return { daysBack, startTime, endTime };
}
