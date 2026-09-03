import {
  AppObserveError,
  AppObserveLogsOrderByField,
  AppObserveMetric,
  AppObserveMetricsListOrderByField,
  AppObserveOrderDirection,
  AppObserveUserEvent,
  AppObserveUserEventListOrderByField,
} from '../../graphql/generated';
import { AppObserveSessionLog, ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { fetchObserveCustomEventsAsync } from '../fetchCustomEvents';
import { fetchObserveEventsAsync } from '../fetchEvents';
import {
  fetchObserveSessionEventsAsync,
  fetchSessionLogCandidatesAsync,
  fetchSessionMetricCandidatesAsync,
} from '../fetchSessions';

jest.mock('../fetchCustomEvents');
jest.mock('../fetchEvents', () => {
  const actual = jest.requireActual('../fetchEvents');
  return {
    ...actual,
    fetchObserveEventsAsync: jest.fn(),
  };
});
jest.mock('../../graphql/queries/ObserveQuery');

const mockFetchObserveEventsAsync = jest.mocked(fetchObserveEventsAsync);
const mockFetchObserveCustomEventsAsync = jest.mocked(fetchObserveCustomEventsAsync);
const mockSessionEventsAsync = jest.mocked(ObserveQuery.sessionEventsAsync);

const noNextPage = { hasNextPage: false, hasPreviousPage: false };

function makeMetricEvent(overrides: Partial<AppObserveMetric> = {}): AppObserveMetric {
  return {
    __typename: 'AppObserveMetric' as const,
    id: 'evt-m-1',
    name: 'expo.app_startup.tti',
    value: 0.5,
    timestamp: '2025-01-15T10:00:00.000Z',
    appVersion: '1.0.0',
    appBuildNumber: '42',
    appUpdateId: 'update-xyz',
    deviceModel: 'iPhone 15',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    countryCode: 'US',
    sessionId: 'session-1',
    easClientId: 'client-1',
    customParams: null,
    ...overrides,
  } as AppObserveMetric;
}

function makeUserEvent(overrides: Partial<AppObserveUserEvent> = {}): AppObserveUserEvent {
  return {
    __typename: 'AppObserveUserEvent' as const,
    id: 'evt-c-1',
    name: 'login_pressed',
    timestamp: '2025-01-15T10:01:00.000Z',
    sessionId: 'session-1',
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
  } as AppObserveUserEvent;
}

function makeUserLog(overrides: Partial<AppObserveUserEvent> = {}): AppObserveSessionLog {
  return makeUserEvent(overrides) as AppObserveSessionLog;
}

function makeErrorLog(overrides: Partial<AppObserveError> = {}): AppObserveSessionLog {
  return {
    __typename: 'AppObserveError' as const,
    id: 'err-1',
    type: 'TypeError',
    message: 'undefined is not a function',
    timestamp: '2025-01-15T10:02:00.000Z',
    sessionId: 'session-1',
    severityText: 'fatal',
    severityNumber: null,
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
  } as AppObserveSessionLog;
}

const baseOptions = {
  limit: 100,
};

describe('fetchObserveSessionEventsAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionEventsAsync.mockResolvedValue({
      metrics: [],
      logs: [],
      metricsPageInfo: noNextPage,
      logsPageInfo: noNextPage,
    });
  });

  it('queries the session timeline oldest-first for both metrics and logs', async () => {
    await fetchObserveSessionEventsAsync({} as any, 'project-1', {
      ...baseOptions,
      sessionId: 'session-1',
    });

    expect(mockSessionEventsAsync).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        appId: 'project-1',
        id: 'session-1',
        first: 100,
        metricsOrderBy: {
          field: AppObserveMetricsListOrderByField.Timestamp,
          direction: AppObserveOrderDirection.Asc,
        },
        logsOrderBy: {
          field: AppObserveLogsOrderByField.Timestamp,
          direction: AppObserveOrderDirection.Asc,
        },
      })
    );
  });

  it('returns combined entries sorted chronologically, tagged with their source', async () => {
    mockSessionEventsAsync.mockResolvedValue({
      metrics: [makeMetricEvent({ timestamp: '2025-01-15T10:05:00.000Z' })],
      logs: [
        makeUserLog({ timestamp: '2025-01-15T10:01:00.000Z' }),
        makeUserLog({ id: 'evt-c-2', timestamp: '2025-01-15T10:10:00.000Z', name: 'logout' }),
      ],
      metricsPageInfo: noNextPage,
      logsPageInfo: noNextPage,
    });

    const result = await fetchObserveSessionEventsAsync({} as any, 'project-1', {
      ...baseOptions,
      sessionId: 'session-1',
    });

    expect(result.entries.map(e => e.timestamp)).toEqual([
      '2025-01-15T10:01:00.000Z',
      '2025-01-15T10:05:00.000Z',
      '2025-01-15T10:10:00.000Z',
    ]);
    expect(result.entries.map(e => e.source)).toEqual(['log', 'metric', 'log']);
  });

  it('includes error logs as log entries named by their exception type, surfacing message and properties', async () => {
    mockSessionEventsAsync.mockResolvedValue({
      metrics: [],
      logs: [
        makeErrorLog({
          properties: [{ key: 'attr', value: 'v', type: 'STRING' }],
        } as Partial<AppObserveError>),
      ],
      metricsPageInfo: noNextPage,
      logsPageInfo: noNextPage,
    });

    const result = await fetchObserveSessionEventsAsync({} as any, 'project-1', {
      ...baseOptions,
      sessionId: 'session-1',
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].source).toBe('log');
    expect(result.entries[0].name).toBe('TypeError');
    expect(result.entries[0].properties).toEqual([
      { key: 'message', value: 'undefined is not a function', type: 'STRING' },
      { key: 'attr', value: 'v', type: 'STRING' },
    ]);
  });

  it('derives session metadata from the entries (first/last timestamps, device, app version)', async () => {
    mockSessionEventsAsync.mockResolvedValue({
      metrics: [makeMetricEvent({ timestamp: '2025-01-15T10:00:00.000Z' })],
      logs: [makeUserLog({ timestamp: '2025-01-15T10:05:00.000Z', appUpdateId: 'update-xyz' })],
      metricsPageInfo: noNextPage,
      logsPageInfo: noNextPage,
    });

    const result = await fetchObserveSessionEventsAsync({} as any, 'project-1', {
      ...baseOptions,
      sessionId: 'session-1',
    });

    expect(result.metadata).toEqual({
      appVersion: '1.0.0',
      appBuildNumber: '42',
      appUpdateId: 'update-xyz',
      deviceOs: 'iOS',
      deviceOsVersion: '17.0',
      deviceModel: 'iPhone 15',
      countryCode: 'US',
      firstSeenAt: '2025-01-15T10:00:00.000Z',
      lastSeenAt: '2025-01-15T10:05:00.000Z',
    });
  });

  it('returns null metadata when no entries are found for the session', async () => {
    const result = await fetchObserveSessionEventsAsync({} as any, 'project-1', {
      ...baseOptions,
      sessionId: 'unknown',
    });
    expect(result.metadata).toBeNull();
  });

  it('reports hasMore* flags from the underlying page info', async () => {
    mockSessionEventsAsync.mockResolvedValue({
      metrics: [],
      logs: [],
      metricsPageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'cm' },
      logsPageInfo: noNextPage,
    });

    const result = await fetchObserveSessionEventsAsync({} as any, 'project-1', {
      ...baseOptions,
      sessionId: 'session-1',
    });

    expect(result.hasMoreMetricEvents).toBe(true);
    expect(result.hasMoreLogEvents).toBe(false);
  });
});

describe('fetchSessionMetricCandidatesAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: noNextPage,
    });
  });

  it('forwards metricName, sort, window, and limit into fetchObserveEventsAsync', async () => {
    await fetchSessionMetricCandidatesAsync({} as any, 'project-1', {
      metricName: 'expo.app_startup.tti',
      sort: 'slowest',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-02-01T00:00:00.000Z',
      limit: 25,
    });

    const options = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(options.metricName).toBe('expo.app_startup.tti');
    expect(options.limit).toBe(25);
    expect(options.startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(options.endTime).toBe('2025-02-01T00:00:00.000Z');
    expect(options.orderBy).toEqual({
      field: AppObserveMetricsListOrderByField.Value,
      direction: AppObserveOrderDirection.Desc,
    });
  });

  it('filters out events without a sessionId', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [
        makeMetricEvent({ id: 'evt-1', sessionId: 'session-a' }),
        makeMetricEvent({ id: 'evt-2', sessionId: null }),
        makeMetricEvent({ id: 'evt-3', sessionId: 'session-b' }),
      ],
      pageInfo: noNextPage,
    });

    const result = await fetchSessionMetricCandidatesAsync({} as any, 'project-1', {
      metricName: 'expo.app_startup.tti',
      sort: 'newest',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-02-01T00:00:00.000Z',
      limit: 25,
    });

    expect(result.map(e => e.id)).toEqual(['evt-1', 'evt-3']);
  });
});

describe('fetchSessionLogCandidatesAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: noNextPage,
    });
  });

  it('forwards eventName, window, and limit into fetchObserveCustomEventsAsync', async () => {
    await fetchSessionLogCandidatesAsync({} as any, 'project-1', {
      eventName: 'login_pressed',
      orderAscending: false,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-02-01T00:00:00.000Z',
      limit: 25,
    });

    const options = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(options.eventName).toBe('login_pressed');
    expect(options.limit).toBe(25);
    expect(options.startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(options.endTime).toBe('2025-02-01T00:00:00.000Z');
  });

  it('requests descending timestamp order when orderAscending is false', async () => {
    await fetchSessionLogCandidatesAsync({} as any, 'project-1', {
      eventName: 'login_pressed',
      orderAscending: false,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-02-01T00:00:00.000Z',
      limit: 25,
    });

    expect(mockFetchObserveCustomEventsAsync.mock.calls[0][2].orderBy).toEqual({
      field: AppObserveUserEventListOrderByField.Timestamp,
      direction: AppObserveOrderDirection.Desc,
    });
  });

  it('requests ascending timestamp order when orderAscending is true', async () => {
    await fetchSessionLogCandidatesAsync({} as any, 'project-1', {
      eventName: 'login_pressed',
      orderAscending: true,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-02-01T00:00:00.000Z',
      limit: 25,
    });

    expect(mockFetchObserveCustomEventsAsync.mock.calls[0][2].orderBy).toEqual({
      field: AppObserveUserEventListOrderByField.Timestamp,
      direction: AppObserveOrderDirection.Asc,
    });
  });

  it('preserves the server-provided order (no client-side re-sorting)', async () => {
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [
        makeUserEvent({ id: 'c', timestamp: '2025-01-15T10:10:00.000Z' }),
        makeUserEvent({ id: 'b', timestamp: '2025-01-15T10:05:00.000Z' }),
        makeUserEvent({ id: 'a', timestamp: '2025-01-15T10:00:00.000Z' }),
      ],
      pageInfo: noNextPage,
    });

    const result = await fetchSessionLogCandidatesAsync({} as any, 'project-1', {
      eventName: 'login_pressed',
      orderAscending: false,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-02-01T00:00:00.000Z',
      limit: 25,
    });
    expect(result.map(e => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('filters out events without a sessionId', async () => {
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [
        makeUserEvent({ id: 'a', sessionId: 'session-a' }),
        makeUserEvent({ id: 'b', sessionId: null }),
      ],
      pageInfo: noNextPage,
    });

    const result = await fetchSessionLogCandidatesAsync({} as any, 'project-1', {
      eventName: 'login_pressed',
      orderAscending: false,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-02-01T00:00:00.000Z',
      limit: 25,
    });
    expect(result.map(e => e.id)).toEqual(['a']);
  });
});
