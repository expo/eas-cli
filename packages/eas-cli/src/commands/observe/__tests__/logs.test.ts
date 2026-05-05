import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { AppObservePlatform } from '../../../graphql/generated';
import { ObserveQuery } from '../../../graphql/queries/ObserveQuery';
import { fetchObserveCustomEventsAsync } from '../../../observe/fetchCustomEvents';
import {
  buildObserveCustomEventNamesJson,
  buildObserveCustomEventsEmptyWithSuggestionsJson,
  buildObserveCustomEventsEmptyWithSuggestionsTable,
  buildObserveCustomEventsJson,
} from '../../../observe/formatCustomEvents';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveLogs from '../logs';

jest.mock('../../../observe/fetchCustomEvents');
jest.mock('../../../observe/formatCustomEvents', () => ({
  buildObserveCustomEventsTable: jest.fn().mockReturnValue('table'),
  buildObserveCustomEventsJson: jest.fn().mockReturnValue({}),
  buildObserveCustomEventNamesTable: jest.fn().mockReturnValue('names-table'),
  buildObserveCustomEventNamesJson: jest.fn().mockReturnValue({ names: [], isTruncated: false }),
  buildObserveCustomEventsEmptyWithSuggestionsTable: jest
    .fn()
    .mockReturnValue('empty-with-suggestions-table'),
  buildObserveCustomEventsEmptyWithSuggestionsJson: jest.fn().mockReturnValue({
    filteredEventName: 'my_event',
    events: [],
    availableEventNames: [],
    availableEventNamesIsTruncated: false,
  }),
}));
jest.mock('../../../graphql/queries/ObserveQuery', () => ({
  ObserveQuery: {
    customEventNamesAsync: jest.fn(),
  },
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveCustomEventsAsync = jest.mocked(fetchObserveCustomEventsAsync);
const mockBuildObserveCustomEventsJson = jest.mocked(buildObserveCustomEventsJson);
const mockBuildObserveCustomEventNamesJson = jest.mocked(buildObserveCustomEventNamesJson);
const mockBuildObserveCustomEventsEmptyWithSuggestionsTable = jest.mocked(
  buildObserveCustomEventsEmptyWithSuggestionsTable
);
const mockBuildObserveCustomEventsEmptyWithSuggestionsJson = jest.mocked(
  buildObserveCustomEventsEmptyWithSuggestionsJson
);
const mockCustomEventNamesAsync = jest.mocked(ObserveQuery.customEventNamesAsync);
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
    mockCustomEventNamesAsync.mockResolvedValue({ names: [], isTruncated: false });
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
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [{ id: 'evt-1' } as any],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    const command = createCommand(['my_event']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.eventName).toBe('my_event');
    expect(mockCustomEventNamesAsync).not.toHaveBeenCalled();
  });

  it('routes to customEventNamesAsync when no positional arg is provided', async () => {
    const command = createCommand([]);
    await command.runAsync();

    expect(mockCustomEventNamesAsync).toHaveBeenCalledTimes(1);
    expect(mockFetchObserveCustomEventsAsync).not.toHaveBeenCalled();
  });

  it('routes to fetchObserveCustomEventsAsync when --all-events is set with no positional arg', async () => {
    const command = createCommand(['--all-events']);
    await command.runAsync();

    expect(mockFetchObserveCustomEventsAsync).toHaveBeenCalledTimes(1);
    expect(mockCustomEventNamesAsync).not.toHaveBeenCalled();
    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.eventName).toBeUndefined();
  });

  it('throws when both an event name argument and --all-events are provided', async () => {
    const command = createCommand(['my_event', '--all-events']);
    await expect(command.runAsync()).rejects.toThrow(
      '--all-events cannot be combined with an event name argument'
    );
    expect(mockFetchObserveCustomEventsAsync).not.toHaveBeenCalled();
    expect(mockCustomEventNamesAsync).not.toHaveBeenCalled();
  });

  it('passes the resolved time range and platform to customEventNamesAsync', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['--days', '7', '--platform', 'ios']);
    await command.runAsync();

    expect(mockCustomEventNamesAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: projectId,
      startTime: '2025-06-08T12:00:00.000Z',
      endTime: '2025-06-15T12:00:00.000Z',
      platform: AppObservePlatform.Ios,
    });

    jest.useRealTimers();
  });

  it('uses --days to compute start/end time range when an event name is provided', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['my_event', '--days', '7']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.endTime).toBe('2025-06-15T12:00:00.000Z');
    expect(options.startTime).toBe('2025-06-08T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('uses explicit --start and --end when provided', async () => {
    const command = createCommand([
      'my_event',
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
    const command = createCommand([
      'my_event',
      '--days',
      '7',
      '--start',
      '2025-01-01T00:00:00.000Z',
    ]);
    await expect(command.runAsync()).rejects.toThrow();
  });

  it('passes --limit to fetchObserveCustomEventsAsync', async () => {
    const command = createCommand(['my_event', '--limit', '42']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.limit).toBe(42);
  });

  it('passes --after cursor', async () => {
    const command = createCommand(['my_event', '--after', 'cursor-xyz']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.after).toBe('cursor-xyz');
  });

  it('passes --platform ios as AppObservePlatform.Ios', async () => {
    const command = createCommand(['my_event', '--platform', 'ios']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.platform).toBe(AppObservePlatform.Ios);
  });

  it('passes --app-version', async () => {
    const command = createCommand(['my_event', '--app-version', '2.1.0']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.appVersion).toBe('2.1.0');
  });

  it('passes --update-id', async () => {
    const command = createCommand(['my_event', '--update-id', 'update-xyz']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.updateId).toBe('update-xyz');
  });

  it('passes --session-id', async () => {
    const command = createCommand(['my_event', '--session-id', 'session-xyz']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.sessionId).toBe('session-xyz');
  });

  it('does not pass platform, appVersion, updateId, or sessionId when flags are not provided', async () => {
    const command = createCommand(['my_event']);
    await command.runAsync();

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.platform).toBeUndefined();
    expect(options.appVersion).toBeUndefined();
    expect(options.updateId).toBeUndefined();
    expect(options.sessionId).toBeUndefined();
  });

  it('calls enableJsonOutput and printJsonOnlyOutput when --json is provided with an event name', async () => {
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

    const command = createCommand(['my_event', '--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveCustomEventsJson).toHaveBeenCalledWith(
      mockEvents,
      expect.objectContaining({ hasNextPage: false })
    );
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });

  it('falls back to fetching event names and renders the empty-with-suggestions table when filtered fetch returns 0 events', async () => {
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    const mockNames = [
      { eventName: 'foo', count: 10 },
      { eventName: 'bar', count: 5 },
    ];
    mockCustomEventNamesAsync.mockResolvedValue({
      names: mockNames as any,
      isTruncated: false,
    });

    const command = createCommand(['my_event']);
    await command.runAsync();

    expect(mockFetchObserveCustomEventsAsync).toHaveBeenCalledTimes(1);
    expect(mockCustomEventNamesAsync).toHaveBeenCalledTimes(1);
    expect(mockBuildObserveCustomEventsEmptyWithSuggestionsTable).toHaveBeenCalledWith(
      'my_event',
      mockNames,
      expect.objectContaining({ isTruncated: false })
    );
  });

  it('does not call customEventNamesAsync when filtered fetch returns at least one event', async () => {
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [
        {
          id: 'evt-1',
          eventName: 'my_event',
          timestamp: '2025-01-15T10:30:00.000Z',
          appVersion: '1.0.0',
          appBuildNumber: '42',
          deviceModel: 'iPhone 15',
          deviceOs: 'iOS',
          deviceOsVersion: '17.0',
          easClientId: 'client-1',
          properties: [],
        } as any,
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const command = createCommand(['my_event']);
    await command.runAsync();

    expect(mockCustomEventNamesAsync).not.toHaveBeenCalled();
    expect(mockBuildObserveCustomEventsEmptyWithSuggestionsTable).not.toHaveBeenCalled();
  });

  it('emits empty-with-suggestions JSON when filtered fetch returns 0 events and --json is set', async () => {
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    const mockNames = [{ eventName: 'foo', count: 10 }];
    mockCustomEventNamesAsync.mockResolvedValue({
      names: mockNames as any,
      isTruncated: false,
    });

    const command = createCommand(['my_event', '--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveCustomEventsEmptyWithSuggestionsJson).toHaveBeenCalledWith(
      'my_event',
      mockNames,
      false
    );
    expect(mockBuildObserveCustomEventsJson).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });

  it('does not run the empty-with-suggestions fallback when no event name is provided (event names mode)', async () => {
    mockCustomEventNamesAsync.mockResolvedValue({ names: [], isTruncated: false });

    const command = createCommand([]);
    await command.runAsync();

    expect(mockBuildObserveCustomEventsEmptyWithSuggestionsTable).not.toHaveBeenCalled();
    expect(mockBuildObserveCustomEventsEmptyWithSuggestionsJson).not.toHaveBeenCalled();
  });

  it('does not run the empty-with-suggestions fallback for --all-events with 0 results', async () => {
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const command = createCommand(['--all-events']);
    await command.runAsync();

    expect(mockCustomEventNamesAsync).not.toHaveBeenCalled();
    expect(mockBuildObserveCustomEventsEmptyWithSuggestionsTable).not.toHaveBeenCalled();
  });

  it('emits JSON of event names + counts when --json is provided without an event name', async () => {
    const mockNames = [
      { eventName: 'foo', count: 10 },
      { eventName: 'bar', count: 5 },
    ];
    mockCustomEventNamesAsync.mockResolvedValue({
      names: mockNames as any,
      isTruncated: false,
    });

    const command = createCommand(['--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveCustomEventNamesJson).toHaveBeenCalledWith(mockNames, false);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });
});
