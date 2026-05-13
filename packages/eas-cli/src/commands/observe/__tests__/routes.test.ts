import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { AppPlatform } from '../../../graphql/generated';
import { fetchObserveNavigationRoutesAsync } from '../../../observe/fetchNavigationRoutes';
import {
  buildObserveNavigationRoutesJson,
  buildObserveNavigationRoutesTable,
} from '../../../observe/formatNavigationRoutes';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveRoutes from '../routes';

jest.mock('../../../observe/fetchNavigationRoutes');
jest.mock('../../../observe/formatNavigationRoutes', () => {
  const actual = jest.requireActual('../../../observe/formatNavigationRoutes');
  return {
    ...actual,
    buildObserveNavigationRoutesTable: jest.fn().mockReturnValue('table'),
    buildObserveNavigationRoutesJson: jest.fn().mockReturnValue({}),
  };
});
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveNavigationRoutesAsync = jest.mocked(fetchObserveNavigationRoutesAsync);
const mockBuildObserveNavigationRoutesTable = jest.mocked(buildObserveNavigationRoutesTable);
const mockBuildObserveNavigationRoutesJson = jest.mocked(buildObserveNavigationRoutesJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

describe(ObserveRoutes, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveNavigationRoutesAsync.mockResolvedValue({
      routes: [],
      pageInfoByPlatform: new Map(),
    });
  });

  function createCommand(argv: string[]): ObserveRoutes {
    const command = new ObserveRoutes(argv, mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('queries both platforms by default with all three navigation metric full names', async () => {
    const command = createCommand([]);
    await command.runAsync();

    expect(mockFetchObserveNavigationRoutesAsync).toHaveBeenCalledTimes(1);
    const options = mockFetchObserveNavigationRoutesAsync.mock.calls[0][2];
    expect(options.platforms).toEqual([AppPlatform.Android, AppPlatform.Ios]);
    expect(options.limit).toBe(50);

    const tableCall = mockBuildObserveNavigationRoutesTable.mock.calls[0];
    expect(tableCall[1]).toEqual([
      'expo.navigation.cold_ttr',
      'expo.navigation.warm_ttr',
      'expo.navigation.tti',
    ]);
    expect(tableCall[2]).toEqual(['median', 'count']);
  });

  it('filters platform when --platform ios is provided', async () => {
    const command = createCommand(['--platform', 'ios']);
    await command.runAsync();

    const options = mockFetchObserveNavigationRoutesAsync.mock.calls[0][2];
    expect(options.platforms).toEqual([AppPlatform.Ios]);
  });

  it('resolves --metric short aliases to navigation metric full names and deduplicates', async () => {
    const command = createCommand([
      '--metric',
      'cold_ttr',
      '--metric',
      'cold_ttr',
      '--metric',
      'nav_tti',
    ]);
    await command.runAsync();

    expect(mockBuildObserveNavigationRoutesTable.mock.calls[0][1]).toEqual([
      'expo.navigation.cold_ttr',
      'expo.navigation.tti',
    ]);
  });

  it('passes --limit and --after through to the fetcher', async () => {
    const command = createCommand(['--limit', '25', '--after', 'cursor-abc']);
    await command.runAsync();

    const options = mockFetchObserveNavigationRoutesAsync.mock.calls[0][2];
    expect(options.limit).toBe(25);
    expect(options.after).toBe('cursor-abc');
  });

  it('uses --days to compute start/end time range', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['--days', '7']);
    await command.runAsync();

    const options = mockFetchObserveNavigationRoutesAsync.mock.calls[0][2];
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');
    expect(options.startTime).toBe('2025-06-08T12:00:00.000Z');

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

    const options = mockFetchObserveNavigationRoutesAsync.mock.calls[0][2];
    expect(options.startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(options.endTime).toBe('2025-02-01T00:00:00.000Z');
  });

  it('rejects --days combined with --start', async () => {
    const command = createCommand(['--days', '7', '--start', '2025-01-01T00:00:00.000Z']);
    await expect(command.runAsync()).rejects.toThrow();
  });

  it('passes app-version, update-id, and build-number filters', async () => {
    const command = createCommand([
      '--app-version',
      '2.1.0',
      '--update-id',
      'update-xyz',
      '--build-number',
      '42',
    ]);
    await command.runAsync();

    const options = mockFetchObserveNavigationRoutesAsync.mock.calls[0][2];
    expect(options.appVersion).toBe('2.1.0');
    expect(options.updateId).toBe('update-xyz');
    expect(options.buildNumber).toBe('42');
  });

  it('resolves --stat aliases and passes them through', async () => {
    const command = createCommand(['--stat', 'p90', '--stat', 'eventCount']);
    await command.runAsync();

    expect(mockBuildObserveNavigationRoutesTable.mock.calls[0][2]).toEqual(['p90', 'count']);
  });

  it('uses default JSON stats (median, p90, count) when --json is set without --stat', async () => {
    const command = createCommand(['--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveNavigationRoutesJson.mock.calls[0][2]).toEqual([
      'median',
      'p90',
      'count',
    ]);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });
});
