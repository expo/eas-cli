import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import {
  AppObserveEventsOrderByDirection,
  AppObserveEventsOrderByField,
  AppObservePlatform,
} from '../../../graphql/generated';
import { fetchObserveEventsAsync, resolveOrderBy } from '../../../observe/fetchEvents';
import { buildObserveEventsJson } from '../../../observe/formatEvents';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveEvents from '../events';

jest.mock('../../../observe/fetchEvents', () => {
  const actual = jest.requireActual('../../../observe/fetchEvents');
  return {
    ...actual,
    fetchObserveEventsAsync: jest.fn(),
  };
});
jest.mock('../../../observe/formatEvents', () => ({
  buildObserveEventsTable: jest.fn().mockReturnValue('table'),
  buildObserveEventsJson: jest.fn().mockReturnValue({}),
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveEventsAsync = jest.mocked(fetchObserveEventsAsync);
const mockBuildObserveEventsJson = jest.mocked(buildObserveEventsJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

describe(ObserveEvents, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
  });

  function createCommand(argv: string[]): ObserveEvents {
    const command = new ObserveEvents(argv, mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('uses --days to compute start/end time range', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['tti', '--days', '7']);
    await command.runAsync();

    expect(mockFetchObserveEventsAsync).toHaveBeenCalledTimes(1);
    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');
    expect(options.startTime).toBe('2025-06-08T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('uses DEFAULT_DAYS_BACK (60 days) when neither --days nor --start/--end are provided', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['tti']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.startTime).toBe('2025-04-16T12:00:00.000Z');
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('uses explicit --start and --end when provided', async () => {
    const command = createCommand([
      'tti',
      '--start',
      '2025-01-01T00:00:00.000Z',
      '--end',
      '2025-02-01T00:00:00.000Z',
    ]);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(options.endTime).toBe('2025-02-01T00:00:00.000Z');
  });

  it('defaults endTime to now when only --start is provided', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['tti', '--start', '2025-01-01T00:00:00.000Z']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('rejects --days combined with --start', async () => {
    const command = createCommand(['tti', '--days', '7', '--start', '2025-01-01T00:00:00.000Z']);

    await expect(command.runAsync()).rejects.toThrow();
  });

  it('passes --limit to fetchObserveEventsAsync', async () => {
    const command = createCommand(['tti', '--limit', '42']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.limit).toBe(42);
  });

  it('passes --after cursor to fetchObserveEventsAsync', async () => {
    const command = createCommand(['tti', '--after', 'cursor-xyz']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.after).toBe('cursor-xyz');
  });

  it('does not pass after when --after flag is not provided', async () => {
    const command = createCommand(['tti']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options).not.toHaveProperty('after');
  });

  it('rejects --days combined with --end', async () => {
    const command = createCommand(['tti', '--days', '7', '--end', '2025-02-01T00:00:00.000Z']);

    await expect(command.runAsync()).rejects.toThrow();
  });

  it('passes --platform ios to fetchObserveEventsAsync as AppObservePlatform.Ios', async () => {
    const command = createCommand(['tti', '--platform', 'ios']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.platform).toBe(AppObservePlatform.Ios);
  });

  it('passes --platform android to fetchObserveEventsAsync as AppObservePlatform.Android', async () => {
    const command = createCommand(['tti', '--platform', 'android']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.platform).toBe(AppObservePlatform.Android);
  });

  it('passes --app-version to fetchObserveEventsAsync', async () => {
    const command = createCommand(['tti', '--app-version', '2.1.0']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.appVersion).toBe('2.1.0');
  });

  it('passes --update-id to fetchObserveEventsAsync', async () => {
    const command = createCommand(['tti', '--update-id', 'update-xyz']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.updateId).toBe('update-xyz');
  });

  it('does not pass platform, appVersion, or updateId when flags are not provided', async () => {
    const command = createCommand(['tti']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.platform).toBeUndefined();
    expect(options.appVersion).toBeUndefined();
    expect(options.updateId).toBeUndefined();
  });

  it('calls enableJsonOutput and printJsonOnlyOutput when --json is provided', async () => {
    const mockEvents = [
      {
        id: 'evt-1',
        metricName: 'expo.app_startup.tti',
        metricValue: 1.23,
        timestamp: '2025-01-15T10:30:00.000Z',
        appVersion: '1.0.0',
        appBuildNumber: '42',
        deviceModel: 'iPhone 15',
        deviceOs: 'iOS',
        deviceOsVersion: '17.0',
        countryCode: 'US',
        sessionId: 'session-1',
        easClientId: 'client-1',
      },
    ];
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: mockEvents as any,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const command = createCommand(['tti', '--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveEventsJson).toHaveBeenCalledWith(
      mockEvents,
      expect.objectContaining({ hasNextPage: false })
    );
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });

  it('does not call enableJsonOutput when --json is not provided', async () => {
    const command = createCommand(['tti']);
    await command.runAsync();

    expect(mockEnableJsonOutput).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
  });

  it('passes --sort flag through to fetchObserveEventsAsync', async () => {
    const command = createCommand(['tti', '--sort', 'slowest']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.orderBy).toEqual({
      field: AppObserveEventsOrderByField.MetricValue,
      direction: AppObserveEventsOrderByDirection.Desc,
    });
  });

  it('throws in non-interactive mode when no metric is provided', async () => {
    const command = createCommand(['--non-interactive']);

    await expect(command.runAsync()).rejects.toThrow(
      'metric argument is required in non-interactive mode'
    );
  });
});

describe(resolveOrderBy, () => {
  it('resolves lowercase "slowest" to MetricValue DESC', () => {
    expect(resolveOrderBy('slowest')).toEqual({
      field: AppObserveEventsOrderByField.MetricValue,
      direction: AppObserveEventsOrderByDirection.Desc,
    });
  });

  it('resolves lowercase "fastest" to MetricValue ASC', () => {
    expect(resolveOrderBy('fastest')).toEqual({
      field: AppObserveEventsOrderByField.MetricValue,
      direction: AppObserveEventsOrderByDirection.Asc,
    });
  });

  it('resolves lowercase "newest" to Timestamp DESC', () => {
    expect(resolveOrderBy('newest')).toEqual({
      field: AppObserveEventsOrderByField.Timestamp,
      direction: AppObserveEventsOrderByDirection.Desc,
    });
  });

  it('resolves lowercase "oldest" to Timestamp ASC', () => {
    expect(resolveOrderBy('oldest')).toEqual({
      field: AppObserveEventsOrderByField.Timestamp,
      direction: AppObserveEventsOrderByDirection.Asc,
    });
  });
});
