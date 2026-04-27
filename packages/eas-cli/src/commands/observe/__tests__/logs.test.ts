import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { AppObservePlatform } from '../../../graphql/generated';
import { fetchObserveCustomEventsAsync } from '../../../observe/fetchCustomEvents';
import { buildObserveCustomEventsJson } from '../../../observe/formatCustomEvents';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveLogs from '../logs';

jest.mock('../../../observe/fetchCustomEvents');
jest.mock('../../../observe/formatCustomEvents', () => ({
  buildObserveCustomEventsTable: jest.fn().mockReturnValue('table'),
  buildObserveCustomEventsJson: jest.fn().mockReturnValue({}),
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveCustomEventsAsync = jest.mocked(fetchObserveCustomEventsAsync);
const mockBuildObserveCustomEventsJson = jest.mocked(buildObserveCustomEventsJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

describe(ObserveLogs, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
  });

  function createCommand(argv: string[]): ObserveLogs {
    const command = new ObserveLogs(argv, mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('passes eventName arg to fetchObserveCustomEventsAsync', async () => {
    const command = createCommand(['my_event']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.eventName).toBe('my_event');
  });

  it('does not pass eventName when no positional arg is provided', async () => {
    const command = createCommand([]);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.eventName).toBeUndefined();
  });

  it('uses --days to compute start/end time range', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['--days', '7']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');
    expect(options.startTime).toBe('2025-06-08T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('uses DEFAULT_DAYS_BACK (60 days) when neither --days nor --start/--end are provided', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand([]);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.startTime).toBe('2025-04-16T12:00:00.000Z');
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');

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

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(options.endTime).toBe('2025-02-01T00:00:00.000Z');
  });

  it('rejects --days combined with --start', async () => {
    const command = createCommand(['--days', '7', '--start', '2025-01-01T00:00:00.000Z']);
    await expect(command.runAsync()).rejects.toThrow();
  });

  it('passes --limit to fetchObserveCustomEventsAsync', async () => {
    const command = createCommand(['--limit', '42']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.limit).toBe(42);
  });

  it('passes --after cursor', async () => {
    const command = createCommand(['--after', 'cursor-xyz']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.after).toBe('cursor-xyz');
  });

  it('passes --platform ios as AppObservePlatform.Ios', async () => {
    const command = createCommand(['--platform', 'ios']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.platform).toBe(AppObservePlatform.Ios);
  });

  it('passes --app-version', async () => {
    const command = createCommand(['--app-version', '2.1.0']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.appVersion).toBe('2.1.0');
  });

  it('passes --update-id', async () => {
    const command = createCommand(['--update-id', 'update-xyz']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.updateId).toBe('update-xyz');
  });

  it('passes --session-id', async () => {
    const command = createCommand(['--session-id', 'session-xyz']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.sessionId).toBe('session-xyz');
  });

  it('does not pass platform, appVersion, updateId, or sessionId when flags are not provided', async () => {
    const command = createCommand([]);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.platform).toBeUndefined();
    expect(options.appVersion).toBeUndefined();
    expect(options.updateId).toBeUndefined();
    expect(options.sessionId).toBeUndefined();
  });

  it('calls enableJsonOutput and printJsonOnlyOutput when --json is provided', async () => {
    const mockEvents = [
      {
        id: 'evt-1',
        eventName: 'my_event',
        timestamp: '2025-01-15T10:30:00.000Z',
        appVersion: '1.0.0',
        appBuildNumber: '42',
        deviceModel: 'iPhone 15',
        deviceOs: 'iOS',
        deviceOsVersion: '17.0',
        countryCode: 'US',
        sessionId: 'session-1',
        easClientId: 'client-1',
        properties: [],
      },
    ];
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: mockEvents as any,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const command = createCommand(['--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveCustomEventsJson).toHaveBeenCalledWith(
      mockEvents,
      expect.objectContaining({ hasNextPage: false })
    );
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });
});
