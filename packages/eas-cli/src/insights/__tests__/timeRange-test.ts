import { resolveInsightsTimeRange } from '../timeRange';

describe(resolveInsightsTimeRange, () => {
  const now = new Date('2026-09-08T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers({ now });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('defaults to the last 7 days', () => {
    expect(resolveInsightsTimeRange({})).toEqual({
      daysBack: 7,
      startTime: '2026-09-01T12:00:00.000Z',
      endTime: '2026-09-08T12:00:00.000Z',
    });
  });

  it('uses --days when given', () => {
    expect(resolveInsightsTimeRange({ days: 1 })).toEqual({
      daysBack: 1,
      startTime: '2026-09-07T12:00:00.000Z',
      endTime: '2026-09-08T12:00:00.000Z',
    });
  });

  it('uses --start and --end when both are given', () => {
    expect(
      resolveInsightsTimeRange({
        start: '2026-08-01T00:00:00.000Z',
        end: '2026-08-02T00:00:00.000Z',
      })
    ).toEqual({
      daysBack: undefined,
      startTime: '2026-08-01T00:00:00.000Z',
      endTime: '2026-08-02T00:00:00.000Z',
    });
  });

  it('ends now when only --start is given', () => {
    expect(resolveInsightsTimeRange({ start: '2026-09-05T00:00:00.000Z' })).toEqual({
      daysBack: undefined,
      startTime: '2026-09-05T00:00:00.000Z',
      endTime: '2026-09-08T12:00:00.000Z',
    });
  });

  it('rejects --end without --start instead of silently ignoring it', () => {
    expect(() => resolveInsightsTimeRange({ end: '2026-09-05T00:00:00.000Z' })).toThrow(
      /--end requires --start/
    );
  });
});
