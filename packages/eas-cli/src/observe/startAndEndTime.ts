import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';
import Log from '../log';

import { validateDateFlag } from './fetchMetrics';
import { EasCommandError } from '../commandUtils/errors';

export const DEFAULT_DAYS_BACK = 60;

export function startAndEndTime({
  daysBack,
  start,
  end,
}: {
  daysBack?: number;
  start?: string;
  end?: string;
}): { startTime: string; endTime: string } {
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
  if (flags.end && !flags.start) {
    throw new EasCommandError('--end requires --start. Pass both, or use --days instead.');
  }

  const daysBack = flags.days ?? (flags.start ? undefined : DEFAULT_DAYS_BACK);
  const { startTime, endTime } = startAndEndTime({
    daysBack,
    start: flags.start,
    end: flags.end,
  });

  // Reachable by swapping --start and --end, or by passing a --start in the future, since --end
  // defaults to now.
  if (new Date(startTime) >= new Date(endTime)) {
    throw new EasCommandError(
      `The requested time range is empty: --start (${startTime}) must be earlier than the end of the range (${endTime}). Pass a --start earlier than the end, or use --days instead.`
    );
  }

  return { daysBack, startTime, endTime };
}

export async function resolveObserveTimeRangeAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  flags: { days?: number; start?: string; end?: string }
): Promise<ReturnType<typeof resolveTimeRange>> {
  const range = resolveTimeRange(flags);
  const access = await ObserveQuery.queryAccessAsync(graphqlClient, appId);
  if (!access.earliestAccessibleTime) {
    return range;
  }
  const cutoff = new Date(access.earliestAccessibleTime);
  if (new Date(range.endTime) <= cutoff) {
    throw new EasCommandError(
      `The Free plan includes the last ${access.maxLookbackDays} days of Observe data. Choose a more recent time range or upgrade to access older retained data.`
    );
  }
  if (new Date(range.startTime) < cutoff) {
    Log.warnToStderr(
      `Showing Observe data from ${cutoff.toISOString()}. The Free plan includes the last ${access.maxLookbackDays} days; upgrade to access older retained data.`
    );
    return { ...range, startTime: cutoff.toISOString(), daysBack: undefined };
  }
  return range;
}
