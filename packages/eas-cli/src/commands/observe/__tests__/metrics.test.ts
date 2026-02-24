import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform, BuildStatus } from '../../../graphql/generated';
import { BuildQuery } from '../../../graphql/queries/BuildQuery';
import { fetchObserveMetricsAsync, validateDateFlag } from '../../../observe/fetchMetrics';
import { buildObserveMetricsJson, buildObserveMetricsTable } from '../../../observe/formatMetrics';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveMetrics from '../metrics';

jest.mock('../../../graphql/queries/BuildQuery', () => ({
  BuildQuery: {
    viewBuildsOnAppAsync: jest.fn(),
  },
}));
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

const mockViewBuildsOnAppAsync = jest.mocked(BuildQuery.viewBuildsOnAppAsync);
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
    mockViewBuildsOnAppAsync.mockResolvedValue([
      {
        __typename: 'Build' as const,
        id: 'build-1',
        platform: AppPlatform.Ios,
        appVersion: '1.0.0',
        status: BuildStatus.Finished,
      } as any,
    ]);
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

  it('fetches builds and metrics with default parameters', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand([]);
    await command.runAsync();

    expect(mockViewBuildsOnAppAsync).toHaveBeenCalledTimes(1);
    expect(mockViewBuildsOnAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        appId: projectId,
        limit: 25,
        offset: 0,
        filter: { status: BuildStatus.Finished },
      })
    );
    expect(mockFetchObserveMetricsAsync).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('passes --platform android as AppPlatform.Android filter', async () => {
    const command = createCommand(['--platform', 'android']);
    await command.runAsync();

    expect(mockViewBuildsOnAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        filter: { status: BuildStatus.Finished, platform: AppPlatform.Android },
      })
    );
  });

  it('passes --platform ios as AppPlatform.Ios filter', async () => {
    const command = createCommand(['--platform', 'ios']);
    await command.runAsync();

    expect(mockViewBuildsOnAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        filter: { status: BuildStatus.Finished, platform: AppPlatform.Ios },
      })
    );
  });

  it('passes --limit to the builds query', async () => {
    const command = createCommand(['--limit', '5']);
    await command.runAsync();

    expect(mockViewBuildsOnAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ limit: 5 })
    );
  });

  it('passes --offset to the builds query', async () => {
    const command = createCommand(['--offset', '10']);
    await command.runAsync();

    expect(mockViewBuildsOnAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ offset: 10 })
    );
  });

  it('defaults offset to 0 when not provided', async () => {
    const command = createCommand([]);
    await command.runAsync();

    expect(mockViewBuildsOnAppAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ offset: 0 })
    );
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

  it('does not call fetchObserveMetricsAsync when no builds found', async () => {
    mockViewBuildsOnAppAsync.mockResolvedValue([]);

    const command = createCommand([]);
    await command.runAsync();

    expect(mockFetchObserveMetricsAsync).not.toHaveBeenCalled();
  });

  it('collects unique platforms from builds for metrics fetch', async () => {
    mockViewBuildsOnAppAsync.mockResolvedValue([
      {
        __typename: 'Build' as const,
        id: 'build-1',
        platform: AppPlatform.Ios,
        appVersion: '1.0.0',
        status: BuildStatus.Finished,
      } as any,
      {
        __typename: 'Build' as const,
        id: 'build-2',
        platform: AppPlatform.Android,
        appVersion: '1.0.0',
        status: BuildStatus.Finished,
      } as any,
      {
        __typename: 'Build' as const,
        id: 'build-3',
        platform: AppPlatform.Ios,
        appVersion: '1.1.0',
        status: BuildStatus.Finished,
      } as any,
    ]);

    const command = createCommand([]);
    await command.runAsync();

    const platformsSet = mockFetchObserveMetricsAsync.mock.calls[0][3] as Set<AppPlatform>;
    expect(platformsSet.size).toBe(2);
    expect(platformsSet.has(AppPlatform.Ios)).toBe(true);
    expect(platformsSet.has(AppPlatform.Android)).toBe(true);
  });

  it('passes resolved --stat flags to buildObserveMetricsTable', async () => {
    const command = createCommand(['--stat', 'p90', '--stat', 'count']);
    await command.runAsync();

    expect(mockBuildObserveMetricsTable).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Map),
      expect.any(Array),
      ['p90', 'eventCount']
    );
  });

  it('deduplicates --stat flags that resolve to the same key', async () => {
    const command = createCommand(['--stat', 'med', '--stat', 'median']);
    await command.runAsync();

    expect(mockBuildObserveMetricsTable).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Map),
      expect.any(Array),
      ['median']
    );
  });

  it('uses default stats when --stat is not provided', async () => {
    const command = createCommand([]);
    await command.runAsync();

    expect(mockBuildObserveMetricsTable).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Map),
      expect.any(Array),
      ['median', 'eventCount']
    );
  });

  it('passes resolved --stat flags to buildObserveMetricsJson when --json is used', async () => {
    const command = createCommand(['--json', '--non-interactive', '--stat', 'min', '--stat', 'avg']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveMetricsJson).toHaveBeenCalledWith(
      expect.any(Array),
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
