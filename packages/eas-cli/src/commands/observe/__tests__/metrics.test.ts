import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../../../graphql/generated';
import { fetchObserveMetricsAsync, validateDateFlag } from '../../../observe/fetchMetrics';
import { buildObserveMetricsJson, buildObserveMetricsTable } from '../../../observe/formatMetrics';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveMetrics from '../metrics';

jest.mock('../../../observe/fetchMetrics', () => {
  const actual = jest.requireActual('../../../observe/fetchMetrics');
  return {
    ...actual,
    fetchObserveMetricsAsync: jest.fn(),
  };
});
jest.mock('../../../observe/formatMetrics', () => ({
  ...jest.requireActual('../../../observe/formatMetrics'),
  buildObserveMetricsTable: jest.fn().mockReturnValue('table'),
  buildObserveMetricsJson: jest.fn().mockReturnValue([]),
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveMetricsAsync = jest.mocked(fetchObserveMetricsAsync);
const mockBuildObserveMetricsTable = jest.mocked(buildObserveMetricsTable);
const mockBuildObserveMetricsJson = jest.mocked(buildObserveMetricsJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

describe(ObserveMetrics, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = {} as unknown as Config;
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveMetricsAsync.mockResolvedValue(new Map());
  });

  function createCommand(argv: string[]): ObserveMetrics {
    const command = new ObserveMetrics(argv, mockConfig);
    // @ts-expect-error getContextAsync is a protected method
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('fetches metrics with default parameters (both platforms)', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand([]);
    await command.runAsync();

    expect(mockFetchObserveMetricsAsync).toHaveBeenCalledTimes(1);
    const platforms = mockFetchObserveMetricsAsync.mock.calls[0][3];
    expect(platforms).toEqual([AppPlatform.Android, AppPlatform.Ios]);

    jest.useRealTimers();
  });

  it('queries only Android when --platform android is passed', async () => {
    const command = createCommand(['--platform', 'android']);
    await command.runAsync();

    const platforms = mockFetchObserveMetricsAsync.mock.calls[0][3];
    expect(platforms).toEqual([AppPlatform.Android]);
  });

  it('queries only iOS when --platform ios is passed', async () => {
    const command = createCommand(['--platform', 'ios']);
    await command.runAsync();

    const platforms = mockFetchObserveMetricsAsync.mock.calls[0][3];
    expect(platforms).toEqual([AppPlatform.Ios]);
  });

  it('resolves --metric aliases before passing to fetchObserveMetricsAsync', async () => {
    const command = createCommand(['--metric', 'tti', '--metric', 'cold_launch']);
    await command.runAsync();

    const metricNames = mockFetchObserveMetricsAsync.mock.calls[0][2];
    expect(metricNames).toEqual(['expo.app_startup.tti', 'expo.app_startup.cold_launch_time']);
  });

  it('uses default time range (60 days back) when no --start/--end flags', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand([]);
    await command.runAsync();

    const startTime = mockFetchObserveMetricsAsync.mock.calls[0][4];
    const endTime = mockFetchObserveMetricsAsync.mock.calls[0][5];
    expect(endTime).toBe('2025-06-15T12:00:00.000Z');
    expect(startTime).toBe('2025-04-16T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('uses explicit --start and --end when provided', async () => {
    const command = createCommand([
      '--start',
      '2025-01-01T00:00:00.000Z',
      '--end',
      '2025-02-01T00:00:00.000Z',
    ]);
    await command.runAsync();

    const startTime = mockFetchObserveMetricsAsync.mock.calls[0][4];
    const endTime = mockFetchObserveMetricsAsync.mock.calls[0][5];
    expect(startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(endTime).toBe('2025-02-01T00:00:00.000Z');
  });

  it('passes resolved --stat flags to buildObserveMetricsTable', async () => {
    const command = createCommand(['--stat', 'p90', '--stat', 'count']);
    await command.runAsync();

    expect(mockBuildObserveMetricsTable).toHaveBeenCalledWith(
      expect.any(Map),
      expect.any(Array),
      ['p90', 'eventCount']
    );
  });

  it('deduplicates --stat flags that resolve to the same key', async () => {
    const command = createCommand(['--stat', 'med', '--stat', 'median']);
    await command.runAsync();

    expect(mockBuildObserveMetricsTable).toHaveBeenCalledWith(
      expect.any(Map),
      expect.any(Array),
      ['median']
    );
  });

  it('uses --days-from-now to compute start/end time range', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['--days-from-now', '7']);
    await command.runAsync();

    const startTime = mockFetchObserveMetricsAsync.mock.calls[0][4];
    const endTime = mockFetchObserveMetricsAsync.mock.calls[0][5];
    expect(endTime).toBe('2025-06-15T12:00:00.000Z');
    expect(startTime).toBe('2025-06-08T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('rejects --days-from-now combined with --start', async () => {
    const command = createCommand(['--days-from-now', '7', '--start', '2025-01-01T00:00:00.000Z']);

    await expect(command.runAsync()).rejects.toThrow();
  });

  it('rejects --days-from-now combined with --end', async () => {
    const command = createCommand(['--days-from-now', '7', '--end', '2025-02-01T00:00:00.000Z']);

    await expect(command.runAsync()).rejects.toThrow();
  });

  it('uses default stats when --stat is not provided', async () => {
    const command = createCommand([]);
    await command.runAsync();

    expect(mockBuildObserveMetricsTable).toHaveBeenCalledWith(
      expect.any(Map),
      expect.any(Array),
      ['median', 'eventCount']
    );
  });

  it('passes resolved --stat flags to buildObserveMetricsJson when --json is used', async () => {
    const command = createCommand([
      '--json',
      '--non-interactive',
      '--stat',
      'min',
      '--stat',
      'avg',
    ]);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveMetricsJson).toHaveBeenCalledWith(
      expect.any(Map),
      expect.any(Array),
      ['min', 'average']
    );
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });
});

describe(validateDateFlag, () => {
  it('throws on invalid --start date', () => {
    expect(() => validateDateFlag('not-a-date', '--start')).toThrow(
      'Invalid --start date: "not-a-date"'
    );
  });

  it('throws on invalid --end date', () => {
    expect(() => validateDateFlag('also-bad', '--end')).toThrow('Invalid --end date: "also-bad"');
  });

  it('accepts valid ISO date in --start', () => {
    expect(() => validateDateFlag('2025-01-01', '--start')).not.toThrow();
  });
});
