import { WorkflowsInsightsRunsOverTimeGranularity } from '../../../graphql/generated';
import { alignInsightsTimespan, granularityForTimespan } from '../granularity';

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

describe(alignInsightsTimespan, () => {
  it('leaves a window that already sits on bucket boundaries alone', () => {
    expect(
      alignInsightsTimespan({
        startTime: '2026-09-01T10:00:00.000Z',
        endTime: '2026-09-01T12:00:00.000Z',
      })
    ).toEqual({
      timespan: { startTime: '2026-09-01T10:00:00.000Z', endTime: '2026-09-01T12:00:00.000Z' },
      granularity: WorkflowsInsightsRunsOverTimeGranularity.Minute,
    });
    expect(
      alignInsightsTimespan({
        startTime: '2026-09-01T00:00:00.000Z',
        endTime: '2026-09-05T00:00:00.000Z',
      })
    ).toEqual({
      timespan: { startTime: '2026-09-01T00:00:00.000Z', endTime: '2026-09-05T00:00:00.000Z' },
      granularity: WorkflowsInsightsRunsOverTimeGranularity.Hour,
    });
  });

  it('widens the bounds out to whole buckets', () => {
    expect(
      alignInsightsTimespan({
        startTime: '2026-09-04T15:20:30.000Z',
        endTime: '2026-09-11T15:20:30.000Z',
      })
    ).toEqual({
      timespan: { startTime: '2026-09-04T00:00:00.000Z', endTime: '2026-09-12T00:00:00.000Z' },
      granularity: WorkflowsInsightsRunsOverTimeGranularity.Day,
    });
  });

  it('falls back to a coarser bucket when widening crosses a threshold', () => {
    // Widening these by minutes and by hours respectively would exceed the limit the server
    // accepts for that bucket size.
    expect(
      alignInsightsTimespan({
        startTime: '2026-09-01T10:00:30.000Z',
        endTime: '2026-09-01T12:00:30.000Z',
      })
    ).toEqual({
      timespan: { startTime: '2026-09-01T10:00:00.000Z', endTime: '2026-09-01T13:00:00.000Z' },
      granularity: WorkflowsInsightsRunsOverTimeGranularity.Hour,
    });
    expect(
      alignInsightsTimespan({
        startTime: '2026-09-01T00:30:00.000Z',
        endTime: '2026-09-05T00:29:00.000Z',
      })
    ).toEqual({
      timespan: { startTime: '2026-09-01T00:00:00.000Z', endTime: '2026-09-06T00:00:00.000Z' },
      granularity: WorkflowsInsightsRunsOverTimeGranularity.Day,
    });
  });

  it('keeps an unaligned single day on hourly buckets', () => {
    expect(
      alignInsightsTimespan({
        startTime: '2026-09-10T15:20:00.000Z',
        endTime: '2026-09-11T15:20:00.000Z',
      })
    ).toEqual({
      timespan: { startTime: '2026-09-10T15:00:00.000Z', endTime: '2026-09-11T16:00:00.000Z' },
      granularity: WorkflowsInsightsRunsOverTimeGranularity.Hour,
    });
  });

  // The server re-runs the same widening on whatever we send, so the result has to be stable
  // or the chart would read a wider window than the overview all over again.
  it('is a fixed point, so the server widening it again changes nothing', () => {
    const once = alignInsightsTimespan({
      startTime: '2026-09-04T15:20:30.000Z',
      endTime: '2026-09-11T15:20:30.000Z',
    });
    expect(alignInsightsTimespan(once.timespan)).toEqual(once);
  });
});
