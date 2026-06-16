import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { AppObservePlatform } from '../../../graphql/generated';
import {
  fetchObserveSessionEventsAsync,
  fetchObserveSessionListAsync,
} from '../../../observe/fetchSessions';
import {
  buildObserveSessionEventsJson,
  buildObserveSessionEventsTable,
  buildObserveSessionListJson,
  buildObserveSessionListTable,
} from '../../../observe/formatSessions';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveSessions from '../sessions';

jest.mock('../../../observe/fetchSessions');
jest.mock('../../../observe/formatSessions', () => ({
  buildObserveSessionListTable: jest.fn().mockReturnValue('list-table'),
  buildObserveSessionListJson: jest.fn().mockReturnValue({}),
  buildObserveSessionEventsTable: jest.fn().mockReturnValue('events-table'),
  buildObserveSessionEventsJson: jest.fn().mockReturnValue({}),
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveSessionListAsync = jest.mocked(fetchObserveSessionListAsync);
const mockFetchObserveSessionEventsAsync = jest.mocked(fetchObserveSessionEventsAsync);
const mockBuildObserveSessionListTable = jest.mocked(buildObserveSessionListTable);
const mockBuildObserveSessionListJson = jest.mocked(buildObserveSessionListJson);
const mockBuildObserveSessionEventsTable = jest.mocked(buildObserveSessionEventsTable);
const mockBuildObserveSessionEventsJson = jest.mocked(buildObserveSessionEventsJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

describe(ObserveSessions, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveSessionListAsync.mockResolvedValue({
      sessions: [],
      scannedMetricEventCount: 0,
      scannedLogEventCount: 0,
      isTruncated: false,
    });
    mockFetchObserveSessionEventsAsync.mockResolvedValue({
      entries: [],
      metadata: null,
      hasMoreMetricEvents: false,
      hasMoreLogEvents: false,
    });
  });

  function createCommand(argv: string[]): ObserveSessions {
    const command = new ObserveSessions(argv, mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('lists sessions when no sessionId argument is given', async () => {
    const command = createCommand([]);
    await command.runAsync();

    expect(mockFetchObserveSessionListAsync).toHaveBeenCalledTimes(1);
    expect(mockFetchObserveSessionEventsAsync).not.toHaveBeenCalled();
    expect(mockBuildObserveSessionListTable).toHaveBeenCalled();
  });

  it('fetches a single-session timeline when a sessionId argument is given', async () => {
    const command = createCommand(['session-abc']);
    await command.runAsync();

    expect(mockFetchObserveSessionEventsAsync).toHaveBeenCalledTimes(1);
    expect(mockFetchObserveSessionListAsync).not.toHaveBeenCalled();
    const options = mockFetchObserveSessionEventsAsync.mock.calls[0][2];
    expect(options.sessionId).toBe('session-abc');
  });

  it('forwards --event-name to the list fetcher and formatter', async () => {
    const command = createCommand(['--event-name', 'login_pressed']);
    await command.runAsync();

    expect(mockFetchObserveSessionListAsync.mock.calls[0][2].eventName).toBe('login_pressed');
    expect(mockBuildObserveSessionListTable.mock.calls[0][1]?.eventName).toBe('login_pressed');
  });

  it('throws when both a session ID argument and --event-name are provided', async () => {
    const command = createCommand(['session-abc', '--event-name', 'login_pressed']);
    await expect(command.runAsync()).rejects.toThrow('--event-name cannot be combined');
    expect(mockFetchObserveSessionListAsync).not.toHaveBeenCalled();
    expect(mockFetchObserveSessionEventsAsync).not.toHaveBeenCalled();
  });

  it('forwards --platform, --app-version, and --update-id to the list fetcher', async () => {
    const command = createCommand([
      '--platform',
      'ios',
      '--app-version',
      '2.1.0',
      '--update-id',
      'update-xyz',
    ]);
    await command.runAsync();

    const options = mockFetchObserveSessionListAsync.mock.calls[0][2];
    expect(options.platform).toBe(AppObservePlatform.Ios);
    expect(options.appVersion).toBe('2.1.0');
    expect(options.updateId).toBe('update-xyz');
  });

  it('forwards --platform, --app-version, and --update-id to the timeline fetcher', async () => {
    const command = createCommand([
      'session-abc',
      '--platform',
      'android',
      '--app-version',
      '2.1.0',
    ]);
    await command.runAsync();

    const options = mockFetchObserveSessionEventsAsync.mock.calls[0][2];
    expect(options.platform).toBe(AppObservePlatform.Android);
    expect(options.appVersion).toBe('2.1.0');
  });

  it('uses --days to compute the time range', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['--days', '7']);
    await command.runAsync();

    const options = mockFetchObserveSessionListAsync.mock.calls[0][2];
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');
    expect(options.startTime).toBe('2025-06-08T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('hardcodes the per-source page size at 100 (events query cap)', async () => {
    const command = createCommand([]);
    await command.runAsync();

    expect(mockFetchObserveSessionListAsync.mock.calls[0][2].limit).toBe(100);
  });

  it('rejects unknown flags like --limit since the per-source size is fixed', async () => {
    const command = createCommand(['--limit', '250']);
    await expect(command.runAsync()).rejects.toThrow();
  });

  it('emits JSON output for the list mode when --json is set', async () => {
    const command = createCommand(['--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveSessionListJson).toHaveBeenCalled();
    expect(mockBuildObserveSessionListTable).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });

  it('emits JSON output for the timeline mode when --json is set with a sessionId', async () => {
    const command = createCommand(['session-abc', '--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveSessionEventsJson).toHaveBeenCalled();
    expect(mockBuildObserveSessionEventsTable).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });
});
