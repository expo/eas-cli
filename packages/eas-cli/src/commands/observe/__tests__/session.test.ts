import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { ObserveQuery } from '../../../graphql/queries/ObserveQuery';
import {
  fetchObserveSessionEventsAsync,
  fetchSessionLogCandidatesAsync,
  fetchSessionMetricCandidatesAsync,
} from '../../../observe/fetchSessions';
import {
  buildObserveSessionEventsJson,
  buildObserveSessionEventsTable,
} from '../../../observe/formatSessions';
import { selectAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveSession from '../session';

jest.mock('../../../observe/fetchSessions');
jest.mock('../../../observe/formatSessions', () => {
  const actual = jest.requireActual('../../../observe/formatSessions');
  return {
    ...actual,
    buildObserveSessionEventsTable: jest.fn().mockReturnValue('events-table'),
    buildObserveSessionEventsJson: jest.fn().mockReturnValue({}),
  };
});
jest.mock('../../../graphql/queries/ObserveQuery', () => ({
  ObserveQuery: {
    customEventNamesAsync: jest.fn(),
  },
}));
jest.mock('../../../prompts', () => {
  const actual = jest.requireActual('../../../prompts');
  return {
    ...actual,
    selectAsync: jest.fn(),
  };
});
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveSessionEventsAsync = jest.mocked(fetchObserveSessionEventsAsync);
const mockFetchSessionMetricCandidatesAsync = jest.mocked(fetchSessionMetricCandidatesAsync);
const mockFetchSessionLogCandidatesAsync = jest.mocked(fetchSessionLogCandidatesAsync);
const mockCustomEventNamesAsync = jest.mocked(ObserveQuery.customEventNamesAsync);
const mockSelectAsync = jest.mocked(selectAsync);
const mockBuildObserveSessionEventsTable = jest.mocked(buildObserveSessionEventsTable);
const mockBuildObserveSessionEventsJson = jest.mocked(buildObserveSessionEventsJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function makeMetricEvent(overrides: any = {}): any {
  return {
    __typename: 'AppObserveEvent',
    id: 'evt-m-1',
    metricName: 'expo.app_startup.tti',
    metricValue: 1.23,
    timestamp: '2025-01-15T10:00:00.000Z',
    appVersion: '1.0.0',
    appBuildNumber: '42',
    appUpdateId: null,
    deviceModel: 'iPhone 15',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    countryCode: 'US',
    sessionId: 'session-metric-1',
    easClientId: 'client-1',
    customParams: null,
    routeName: null,
    ...overrides,
  };
}

function makeCustomEvent(overrides: any = {}): any {
  return {
    __typename: 'AppObserveCustomEvent',
    id: 'evt-c-1',
    eventName: 'login_pressed',
    timestamp: '2025-01-15T10:00:00.000Z',
    sessionId: 'session-log-1',
    severityNumber: null,
    severityText: null,
    appVersion: '1.0.0',
    appBuildNumber: '42',
    appUpdateId: null,
    appEasBuildId: null,
    deviceModel: 'iPhone 15',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    environment: 'production',
    easClientId: 'client-1',
    countryCode: 'US',
    properties: [],
    ...overrides,
  };
}

describe(ObserveSession, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveSessionEventsAsync.mockResolvedValue({
      entries: [],
      metadata: null,
      hasMoreMetricEvents: false,
      hasMoreLogEvents: false,
    });
    mockFetchSessionMetricCandidatesAsync.mockResolvedValue([]);
    mockFetchSessionLogCandidatesAsync.mockResolvedValue([]);
    mockCustomEventNamesAsync.mockResolvedValue({ names: [], isTruncated: false });
  });

  function createCommand(argv: string[]): ObserveSession {
    const command = new ObserveSession(argv, mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  // ---- existing single-session behavior ----

  it('passes the session ID argument to the fetcher', async () => {
    const command = createCommand(['session-abc']);
    await command.runAsync();

    expect(mockFetchObserveSessionEventsAsync).toHaveBeenCalledTimes(1);
    expect(mockFetchObserveSessionEventsAsync.mock.calls[0][2].sessionId).toBe('session-abc');
  });

  it('hardcodes the per-source page size at 100', async () => {
    const command = createCommand(['session-abc']);
    await command.runAsync();

    expect(mockFetchObserveSessionEventsAsync.mock.calls[0][2].limit).toBe(100);
  });

  it('renders the timeline table by default', async () => {
    const command = createCommand(['session-abc']);
    await command.runAsync();

    expect(mockBuildObserveSessionEventsTable).toHaveBeenCalled();
    expect(mockBuildObserveSessionEventsJson).not.toHaveBeenCalled();
  });

  it('emits JSON output when --json is set with a session ID', async () => {
    const command = createCommand(['session-abc', '--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveSessionEventsJson).toHaveBeenCalled();
    expect(mockBuildObserveSessionEventsTable).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });

  it('rejects unsupported filter flags like --platform', async () => {
    const command = createCommand(['session-abc', '--platform', 'ios']);
    await expect(command.runAsync()).rejects.toThrow();
  });

  // ---- new picker-mode behavior ----

  it('errors when no session ID is provided in non-interactive mode', async () => {
    const command = createCommand(['--non-interactive']);
    await expect(command.runAsync()).rejects.toThrow(/session ID argument is required/);
    expect(mockFetchObserveSessionEventsAsync).not.toHaveBeenCalled();
  });

  it('rejects picker flags when a session ID is also provided', async () => {
    const command = createCommand(['session-abc', '--event-name', 'tti']);
    await expect(command.runAsync()).rejects.toThrow(/picker flags/);
  });

  it('rejects --days when a session ID is also provided', async () => {
    const command = createCommand(['session-abc', '--days', '7']);
    await expect(command.runAsync()).rejects.toThrow(/picker flags/);
  });

  it('picker mode with --event-name tti fetches metric events and threads selected sessionId', async () => {
    mockFetchSessionMetricCandidatesAsync.mockResolvedValue([
      makeMetricEvent({ sessionId: 'picked-session-1' }),
    ]);
    // 1) sort prompt (no --sort flag), 2) event picker
    mockSelectAsync.mockResolvedValueOnce('newest').mockResolvedValueOnce('picked-session-1');

    const command = createCommand(['--event-name', 'tti']);
    await command.runAsync();

    expect(mockFetchSessionMetricCandidatesAsync).toHaveBeenCalledTimes(1);
    const options = mockFetchSessionMetricCandidatesAsync.mock.calls[0][2];
    expect(options.metricName).toBe('expo.app_startup.tti');
    expect(options.limit).toBe(25);

    expect(mockFetchSessionLogCandidatesAsync).not.toHaveBeenCalled();
    expect(mockFetchObserveSessionEventsAsync).toHaveBeenCalledWith(
      graphqlClient,
      projectId,
      expect.objectContaining({ sessionId: 'picked-session-1' })
    );
  });

  it('picker mode with an unknown --event-name treats it as a log event and fetches custom events', async () => {
    mockFetchSessionLogCandidatesAsync.mockResolvedValue([
      makeCustomEvent({ sessionId: 'picked-log-session-1' }),
    ]);
    // 1) sort prompt (no --sort flag), 2) event picker
    mockSelectAsync.mockResolvedValueOnce('newest').mockResolvedValueOnce('picked-log-session-1');

    const command = createCommand(['--event-name', 'login_pressed']);
    await command.runAsync();

    expect(mockFetchSessionLogCandidatesAsync).toHaveBeenCalledTimes(1);
    expect(mockFetchSessionLogCandidatesAsync.mock.calls[0][2].eventName).toBe('login_pressed');
    expect(mockFetchSessionMetricCandidatesAsync).not.toHaveBeenCalled();
    expect(mockFetchObserveSessionEventsAsync).toHaveBeenCalledWith(
      graphqlClient,
      projectId,
      expect.objectContaining({ sessionId: 'picked-log-session-1' })
    );
  });

  it('picker mode without --event-name or --sort prompts for event name, then sort, then event', async () => {
    mockCustomEventNamesAsync.mockResolvedValue({
      names: [
        { __typename: 'AppObserveCustomEventName', eventName: 'login_pressed', count: 12 } as any,
      ],
      isTruncated: false,
    });
    // 1) event-name picker → metric choice
    // 2) sort picker → newest
    // 3) event picker → sessionId
    mockSelectAsync
      .mockResolvedValueOnce({ name: 'expo.app_startup.tti', isMetric: true } as any)
      .mockResolvedValueOnce('newest')
      .mockResolvedValueOnce('picked-session-2');
    mockFetchSessionMetricCandidatesAsync.mockResolvedValue([
      makeMetricEvent({ sessionId: 'picked-session-2' }),
    ]);

    const command = createCommand([]);
    await command.runAsync();

    expect(mockCustomEventNamesAsync).toHaveBeenCalledTimes(1);
    expect(mockSelectAsync).toHaveBeenCalledTimes(3);
    expect(mockFetchSessionMetricCandidatesAsync).toHaveBeenCalledTimes(1);
    expect(mockFetchSessionMetricCandidatesAsync.mock.calls[0][2].metricName).toBe(
      'expo.app_startup.tti'
    );
    expect(mockFetchObserveSessionEventsAsync.mock.calls[0][2].sessionId).toBe('picked-session-2');
  });

  it('prompts for sort order when --sort is not provided and offers metric-only options for metric events', async () => {
    mockFetchSessionMetricCandidatesAsync.mockResolvedValue([
      makeMetricEvent({ sessionId: 'picked-session-3' }),
    ]);
    mockSelectAsync.mockResolvedValueOnce('slowest').mockResolvedValueOnce('picked-session-3');

    const command = createCommand(['--event-name', 'tti']);
    await command.runAsync();

    // First selectAsync is the sort picker; verify choice values
    const sortChoices = mockSelectAsync.mock.calls[0][1];
    expect(sortChoices.map((c: any) => c.value)).toEqual([
      'newest',
      'oldest',
      'slowest',
      'fastest',
    ]);
  });

  it('prompts for sort order without fastest/slowest for log events', async () => {
    mockFetchSessionLogCandidatesAsync.mockResolvedValue([
      makeCustomEvent({ sessionId: 'picked-log-session-2' }),
    ]);
    mockSelectAsync.mockResolvedValueOnce('newest').mockResolvedValueOnce('picked-log-session-2');

    const command = createCommand(['--event-name', 'login_pressed']);
    await command.runAsync();

    const sortChoices = mockSelectAsync.mock.calls[0][1];
    expect(sortChoices.map((c: any) => c.value)).toEqual(['newest', 'oldest']);
  });

  it('skips the sort prompt when --sort is provided explicitly', async () => {
    mockFetchSessionMetricCandidatesAsync.mockResolvedValue([
      makeMetricEvent({ sessionId: 'picked-session-4' }),
    ]);
    mockSelectAsync.mockResolvedValueOnce('picked-session-4');

    const command = createCommand(['--event-name', 'tti', '--sort', 'oldest']);
    await command.runAsync();

    // Only the event picker was called, not the sort picker
    expect(mockSelectAsync).toHaveBeenCalledTimes(1);
  });

  it('forwards --sort=slowest to the metric candidate fetcher', async () => {
    mockFetchSessionMetricCandidatesAsync.mockResolvedValue([makeMetricEvent()]);
    mockSelectAsync.mockResolvedValueOnce('session-metric-1');

    const command = createCommand(['--event-name', 'tti', '--sort', 'slowest']);
    await command.runAsync();

    expect(mockFetchSessionMetricCandidatesAsync.mock.calls[0][2].sort).toBe('slowest');
  });

  it('throws when --sort=slowest is combined with a log event name', async () => {
    const command = createCommand(['--event-name', 'login_pressed', '--sort', 'slowest']);
    await expect(command.runAsync()).rejects.toThrow(/only supported for metric events/);
    expect(mockFetchSessionLogCandidatesAsync).not.toHaveBeenCalled();
  });

  it('passes orderAscending=true to the log candidate fetcher for --sort=oldest', async () => {
    mockFetchSessionLogCandidatesAsync.mockResolvedValue([makeCustomEvent()]);
    mockSelectAsync.mockResolvedValueOnce('session-log-1');

    const command = createCommand(['--event-name', 'login_pressed', '--sort', 'oldest']);
    await command.runAsync();

    expect(mockFetchSessionLogCandidatesAsync.mock.calls[0][2].orderAscending).toBe(true);
  });

  it('passes orderAscending=false to the log candidate fetcher for --sort=newest', async () => {
    mockFetchSessionLogCandidatesAsync.mockResolvedValue([makeCustomEvent()]);
    mockSelectAsync.mockResolvedValueOnce('session-log-1');

    const command = createCommand(['--event-name', 'login_pressed', '--sort', 'newest']);
    await command.runAsync();

    expect(mockFetchSessionLogCandidatesAsync.mock.calls[0][2].orderAscending).toBe(false);
  });

  it('throws when the metric picker returns no candidate events', async () => {
    mockFetchSessionMetricCandidatesAsync.mockResolvedValue([]);
    mockSelectAsync.mockResolvedValueOnce('newest');
    const command = createCommand(['--event-name', 'tti']);
    await expect(command.runAsync()).rejects.toThrow(/No events found/);
    expect(mockFetchObserveSessionEventsAsync).not.toHaveBeenCalled();
  });

  it('offers each returned candidate as a choice in the event picker', async () => {
    mockFetchSessionMetricCandidatesAsync.mockResolvedValue([
      makeMetricEvent({ sessionId: 'session-a' }),
      makeMetricEvent({ id: 'evt-m-2', sessionId: 'session-b' }),
    ]);
    // 1) sort prompt, 2) event picker
    mockSelectAsync.mockResolvedValueOnce('newest').mockResolvedValueOnce('session-a');

    const command = createCommand(['--event-name', 'tti']);
    await command.runAsync();

    // Second selectAsync call is the event picker
    const eventChoices = mockSelectAsync.mock.calls[1][1];
    expect(eventChoices).toHaveLength(2);
    expect(eventChoices.map((c: any) => c.value)).toEqual(['session-a', 'session-b']);
  });

  it('rejects --sort when a session ID is also provided', async () => {
    const command = createCommand(['session-abc', '--sort', 'slowest']);
    await expect(command.runAsync()).rejects.toThrow(/picker flags/);
  });
});
