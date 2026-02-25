import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppObservePlatform } from '../../../graphql/generated';
import { fetchObserveEventsAsync } from '../../../observe/fetchEvents';
import { buildObserveEventsJson } from '../../../observe/formatEvents';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveEvents from '../events';

jest.mock('../../../observe/fetchEvents');
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
  const mockConfig = {} as unknown as Config;
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

  it('uses --days-from-now to compute start/end time range', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['--metric', 'tti', '--days-from-now', '7']);
    await command.runAsync();

    expect(mockFetchObserveEventsAsync).toHaveBeenCalledTimes(1);
    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');
    expect(options.startTime).toBe('2025-06-08T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('uses DEFAULT_DAYS_BACK (60 days) when neither --days-from-now nor --start/--end are provided', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['--metric', 'tti']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.startTime).toBe('2025-04-16T12:00:00.000Z');
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('uses explicit --start and --end when provided', async () => {
    const command = createCommand([
      '--metric',
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

    const command = createCommand(['--metric', 'tti', '--start', '2025-01-01T00:00:00.000Z']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('rejects --days-from-now combined with --start', async () => {
    const command = createCommand([
      '--metric',
      'tti',
      '--days-from-now',
      '7',
      '--start',
      '2025-01-01T00:00:00.000Z',
    ]);

    await expect(command.runAsync()).rejects.toThrow();
  });

  it('passes --limit to fetchObserveEventsAsync', async () => {
    const command = createCommand(['--metric', 'tti', '--limit', '42']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.limit).toBe(42);
  });

  it('passes --after cursor to fetchObserveEventsAsync', async () => {
    const command = createCommand(['--metric', 'tti', '--after', 'cursor-xyz']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.after).toBe('cursor-xyz');
  });

  it('does not pass after when --after flag is not provided', async () => {
    const command = createCommand(['--metric', 'tti']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options).not.toHaveProperty('after');
  });

  it('rejects --days-from-now combined with --end', async () => {
    const command = createCommand([
      '--metric',
      'tti',
      '--days-from-now',
      '7',
      '--end',
      '2025-02-01T00:00:00.000Z',
    ]);

    await expect(command.runAsync()).rejects.toThrow();
  });

  it('passes --platform ios to fetchObserveEventsAsync as AppObservePlatform.Ios', async () => {
    const command = createCommand(['--metric', 'tti', '--platform', 'ios']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.platform).toBe(AppObservePlatform.Ios);
  });

  it('passes --platform android to fetchObserveEventsAsync as AppObservePlatform.Android', async () => {
    const command = createCommand(['--metric', 'tti', '--platform', 'android']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.platform).toBe(AppObservePlatform.Android);
  });

  it('passes --app-version to fetchObserveEventsAsync', async () => {
    const command = createCommand(['--metric', 'tti', '--app-version', '2.1.0']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.appVersion).toBe('2.1.0');
  });

  it('passes --update-id to fetchObserveEventsAsync', async () => {
    const command = createCommand(['--metric', 'tti', '--update-id', 'update-xyz']);
    await command.runAsync();

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.updateId).toBe('update-xyz');
  });

  it('does not pass platform, appVersion, or updateId when flags are not provided', async () => {
    const command = createCommand(['--metric', 'tti']);
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

    const command = createCommand(['--metric', 'tti', '--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveEventsJson).toHaveBeenCalledWith(
      mockEvents,
      expect.objectContaining({ hasNextPage: false })
    );
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });

  it('does not call enableJsonOutput when --json is not provided', async () => {
    const command = createCommand(['--metric', 'tti']);
    await command.runAsync();

    expect(mockEnableJsonOutput).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
  });
});
