import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import Log from '../../log';
import { resolveObserveTimeRangeAsync, resolveTimeRange } from '../startAndEndTime';

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

  it('rejects a range that ends before it starts', () => {
    expect(() =>
      resolveTimeRange({ start: '2026-08-02T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' })
    ).toThrow(/requested time range is empty/);
  });

  it('rejects a zero-length range', () => {
    expect(() =>
      resolveTimeRange({ start: '2026-08-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' })
    ).toThrow(/requested time range is empty/);
  });
});

describe('Observe query window', () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const cutoff = '2026-11-18T12:00:00.000Z';

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-25T12:00:00.000Z') });
    jest
      .spyOn(ObserveQuery, 'queryAccessAsync')
      .mockResolvedValue({ maxLookbackDays: 7, earliestAccessibleTime: cutoff });
    jest.spyOn(Log, 'warnToStderr').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uses the server cutoff for default ranges and warns on stderr', async () => {
    expect(await resolveObserveTimeRangeAsync(graphqlClient, 'app', {})).toEqual({
      startTime: cutoff,
      endTime: '2026-11-25T12:00:00.000Z',
      daysBack: undefined,
    });
    expect(Log.warnToStderr).toHaveBeenCalledWith(expect.stringContaining('last 7 days'));
  });

  it('rejects wholly unavailable ranges', async () => {
    await expect(
      resolveObserveTimeRangeAsync(graphqlClient, 'app', { start: '2026-11-01', end: '2026-11-02' })
    ).rejects.toThrow('Choose a more recent time range or upgrade');
  });

  it('leaves allowed and paid ranges unchanged', async () => {
    expect(await resolveObserveTimeRangeAsync(graphqlClient, 'app', { days: 1 })).toEqual(
      resolveTimeRange({ days: 1 })
    );
    expect(Log.warnToStderr).not.toHaveBeenCalled();
    jest
      .mocked(ObserveQuery.queryAccessAsync)
      .mockResolvedValue({ maxLookbackDays: null, earliestAccessibleTime: null });
    expect(await resolveObserveTimeRangeAsync(graphqlClient, 'app', {})).toEqual(
      resolveTimeRange({})
    );
  });

  it('does not treat a failed access lookup as unrestricted', async () => {
    jest.mocked(ObserveQuery.queryAccessAsync).mockRejectedValue(new Error('offline'));
    await expect(resolveObserveTimeRangeAsync(graphqlClient, 'app', {})).rejects.toThrow('offline');
  });
});
