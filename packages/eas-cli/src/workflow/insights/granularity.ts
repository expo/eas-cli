import {
  WorkflowDeviceTestCaseInsightsTimeSeriesGranularity,
  WorkflowsInsightsRunsOverTimeGranularity,
} from '../../graphql/generated';
import { InsightsTimespanBounds } from '../../insights/formatTimespan';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// The server accepts MINUTE buckets for windows up to 2 hours and HOUR buckets
// for windows up to 4 days.
const MINUTE_GRANULARITY_MAX_HOURS = 2;
const HOUR_GRANULARITY_MAX_HOURS = 4 * 24;

const GRANULARITY_INTERVAL_MS: Record<WorkflowsInsightsRunsOverTimeGranularity, number> = {
  [WorkflowsInsightsRunsOverTimeGranularity.Minute]: MINUTE_MS,
  [WorkflowsInsightsRunsOverTimeGranularity.Hour]: HOUR_MS,
  [WorkflowsInsightsRunsOverTimeGranularity.Day]: DAY_MS,
};

// Finest first, derived from the table above so a bucket size added to the generated enum cannot
// be silently skipped here.
const GRANULARITIES_FINEST_FIRST = (
  Object.keys(GRANULARITY_INTERVAL_MS) as WorkflowsInsightsRunsOverTimeGranularity[]
).sort((a, b) => GRANULARITY_INTERVAL_MS[a] - GRANULARITY_INTERVAL_MS[b]);

export function granularityForTimespan(
  startTime: string,
  endTime: string
): WorkflowsInsightsRunsOverTimeGranularity {
  const hours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / HOUR_MS;
  if (hours <= MINUTE_GRANULARITY_MAX_HOURS) {
    return WorkflowsInsightsRunsOverTimeGranularity.Minute;
  }
  if (hours <= HOUR_GRANULARITY_MAX_HOURS) {
    return WorkflowsInsightsRunsOverTimeGranularity.Hour;
  }
  return WorkflowsInsightsRunsOverTimeGranularity.Day;
}

/**
 * Widen a requested window out to whole buckets, and report the bucket size the widened window
 * needs.
 *
 * The server widens only the runs-over-time query to whole buckets and leaves the overview and
 * per-workflow queries on the exact bounds, so an unaligned window makes those sections count
 * different runs. Sending the widened window turns that server-side widening into a no-op.
 *
 * Widening lengthens the window, which can push it past the threshold of the very bucket size it
 * was widened by, so each candidate is only accepted if the widened window still asks for it.
 * Falling through to the coarsest bucket means every finer one was ruled out, and widening by a
 * coarser bucket is at least as wide, so the coarsest is always self-consistent.
 *
 * Widening the end past now puts unelapsed time in the current period while the previous period
 * the server compares it against is complete, so count metrics span unequal exposure.
 */
export function alignInsightsTimespan(timespan: InsightsTimespanBounds): {
  timespan: InsightsTimespanBounds;
  granularity: WorkflowsInsightsRunsOverTimeGranularity;
} {
  const startMs = new Date(timespan.startTime).getTime();
  const endMs = new Date(timespan.endTime).getTime();

  // Every candidate widens the originally requested window, so a coarser one does not stack
  // another bucket of padding onto an already widened window.
  const coarsest = GRANULARITIES_FINEST_FIRST[GRANULARITIES_FINEST_FIRST.length - 1];
  const granularity =
    GRANULARITIES_FINEST_FIRST.slice(0, -1).find(candidate => {
      const widened = widenToWholeBuckets(startMs, endMs, candidate);
      return granularityForTimespan(widened.startTime, widened.endTime) === candidate;
    }) ?? coarsest;

  return { timespan: widenToWholeBuckets(startMs, endMs, granularity), granularity };
}

function widenToWholeBuckets(
  startMs: number,
  endMs: number,
  granularity: WorkflowsInsightsRunsOverTimeGranularity
): { startTime: string; endTime: string } {
  const interval = GRANULARITY_INTERVAL_MS[granularity];
  return {
    startTime: new Date(Math.floor(startMs / interval) * interval).toISOString(),
    endTime: new Date(Math.ceil(endMs / interval) * interval).toISOString(),
  };
}

// Maestro insights use their own enum for the same three bucket sizes.
const MAESTRO_GRANULARITY: Record<
  WorkflowsInsightsRunsOverTimeGranularity,
  WorkflowDeviceTestCaseInsightsTimeSeriesGranularity
> = {
  [WorkflowsInsightsRunsOverTimeGranularity.Minute]:
    WorkflowDeviceTestCaseInsightsTimeSeriesGranularity.Minute,
  [WorkflowsInsightsRunsOverTimeGranularity.Hour]:
    WorkflowDeviceTestCaseInsightsTimeSeriesGranularity.Hour,
  [WorkflowsInsightsRunsOverTimeGranularity.Day]:
    WorkflowDeviceTestCaseInsightsTimeSeriesGranularity.Day,
};

export function alignMaestroInsightsTimespan(timespan: InsightsTimespanBounds): {
  timespan: InsightsTimespanBounds;
  granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity;
} {
  const aligned = alignInsightsTimespan(timespan);
  return {
    timespan: aligned.timespan,
    granularity: MAESTRO_GRANULARITY[aligned.granularity],
  };
}
