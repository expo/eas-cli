import { WorkflowsInsightsRunsOverTimeGranularity } from '../../../graphql/generated';
import { granularityForTimespan } from '../granularity';

describe(granularityForTimespan, () => {
  const start = '2026-09-01T00:00:00.000Z';

  it('uses minutes for windows up to 2 hours', () => {
    expect(granularityForTimespan(start, '2026-09-01T02:00:00.000Z')).toBe(
      WorkflowsInsightsRunsOverTimeGranularity.Minute
    );
  });

  it('uses hours for windows up to 4 days', () => {
    expect(granularityForTimespan(start, '2026-09-01T02:00:01.000Z')).toBe(
      WorkflowsInsightsRunsOverTimeGranularity.Hour
    );
    expect(granularityForTimespan(start, '2026-09-05T00:00:00.000Z')).toBe(
      WorkflowsInsightsRunsOverTimeGranularity.Hour
    );
  });

  it('uses days for longer windows', () => {
    expect(granularityForTimespan(start, '2026-09-05T00:00:01.000Z')).toBe(
      WorkflowsInsightsRunsOverTimeGranularity.Day
    );
    expect(granularityForTimespan(start, '2026-10-01T00:00:00.000Z')).toBe(
      WorkflowsInsightsRunsOverTimeGranularity.Day
    );
  });
});
