import { WorkflowsInsightsRunsOverTimeGranularity } from '../../graphql/generated';

const HOUR_MS = 60 * 60 * 1000;
// The server accepts MINUTE buckets for windows up to 2 hours and HOUR buckets
// for windows up to 4 days.
const MINUTE_GRANULARITY_MAX_HOURS = 2;
const HOUR_GRANULARITY_MAX_HOURS = 4 * 24;

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
