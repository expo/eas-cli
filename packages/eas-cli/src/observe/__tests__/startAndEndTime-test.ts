import { resolveTimeRange } from '../startAndEndTime';

describe(resolveTimeRange, () => {
  const now = new Date('2026-09-08T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers({ now });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('defaults to the last 60 days', () => {
    expect(resolveTimeRange({})).toEqual({
      daysBack: 60,
      startTime: '2026-07-10T12:00:00.000Z',
      endTime: '2026-09-08T12:00:00.000Z',
    });
  });

  it('uses --start and --end when both are given', () => {
    expect(
      resolveTimeRange({ start: '2026-08-01T00:00:00.000Z', end: '2026-08-02T00:00:00.000Z' })
    ).toEqual({
      daysBack: undefined,
      startTime: '2026-08-01T00:00:00.000Z',
      endTime: '2026-08-02T00:00:00.000Z',
    });
  });

  it('rejects --end without --start instead of silently ignoring it', () => {
    expect(() => resolveTimeRange({ end: '2026-08-02T00:00:00.000Z' })).toThrow(
      /--end requires --start/
    );
  });

  it('rejects an invalid --start date', () => {
    expect(() => resolveTimeRange({ start: 'yesterday' })).toThrow(/Invalid --start date/);
  });
});
