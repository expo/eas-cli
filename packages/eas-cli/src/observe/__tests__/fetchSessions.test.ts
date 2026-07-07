import {
  AppObserveCustomEvent,
  AppObserveEvent,
  AppObserveEventsOrderByDirection,
  AppObserveEventsOrderByField,
} from '../../graphql/generated';
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

const mockFetchObserveEventsAsync = jest.mocked(fetchObserveEventsAsync);
const mockFetchObserveCustomEventsAsync = jest.mocked(fetchObserveCustomEventsAsync);

function makeMetricEvent(overrides: Partial<AppObserveEvent> = {}): AppObserveEvent {
  return {
    __typename: 'AppObserveEvent' as const,
    id: 'evt-m-1',
    metricName: 'expo.app_startup.tti',
    metricValue: 0.5,
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
  } as AppObserveEvent;
}

function makeCustomEvent(overrides: Partial<AppObserveCustomEvent> = {}): AppObserveCustomEvent {
  return {
    __typename: 'AppObserveCustomEvent' as const,
    id: 'evt-c-1',
    eventName: 'login_pressed',
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
  } as AppObserveCustomEvent;
}

const baseOptions = {
  limit: 100,
};

describe('fetchObserveSessionEventsAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
  });

  it('forwards sessionId to both event sources and orders metric events oldest-first', async () => {
    await fetchObserveSessionEventsAsync({} as any, 'project-1', {
      ...baseOptions,
      sessionId: 'session-1',
    });

    expect(mockFetchObserveEventsAsync.mock.calls[0][2].sessionId).toBe('session-1');
    expect(mockFetchObserveEventsAsync.mock.calls[0][2].orderBy).toEqual({
      field: AppObserveEventsOrderByField.Timestamp,
      direction: AppObserveEventsOrderByDirection.Asc,
    });
    expect(mockFetchObserveCustomEventsAsync.mock.calls[0][2].sessionId).toBe('session-1');
  });

  it('returns combined entries sorted chronologically, tagged with their source', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [makeMetricEvent({ timestamp: '2025-01-15T10:05:00.000Z' })],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [
        makeCustomEvent({ timestamp: '2025-01-15T10:01:00.000Z' }),
        makeCustomEvent({
          id: 'evt-c-2',
          timestamp: '2025-01-15T10:10:00.000Z',
          eventName: 'logout',
        }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
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

  it('derives session metadata from the entries (first/last timestamps, device, app version)', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [
        makeMetricEvent({
          timestamp: '2025-01-15T10:00:00.000Z',
          appVersion: '1.0.0',
          appBuildNumber: '42',
          deviceOs: 'iOS',
          deviceOsVersion: '17.0',
          deviceModel: 'iPhone 15',
          appUpdateId: 'update-xyz',
          countryCode: 'US',
        }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [
        makeCustomEvent({
          timestamp: '2025-01-15T10:05:00.000Z',
          appUpdateId: 'update-xyz',
        }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
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
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'cm' },
    });
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
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
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
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
      field: AppObserveEventsOrderByField.MetricValue,
      direction: AppObserveEventsOrderByDirection.Desc,
    });
  });

  it('filters out events without a sessionId', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [
        makeMetricEvent({ id: 'evt-1', sessionId: 'session-a' }),
        makeMetricEvent({ id: 'evt-2', sessionId: null }),
        makeMetricEvent({ id: 'evt-3', sessionId: 'session-b' }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
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
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
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

  it('sorts client-side descending when orderAscending is false (newest first)', async () => {
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [
        makeCustomEvent({ id: 'a', timestamp: '2025-01-15T10:00:00.000Z' }),
        makeCustomEvent({ id: 'c', timestamp: '2025-01-15T10:10:00.000Z' }),
        makeCustomEvent({ id: 'b', timestamp: '2025-01-15T10:05:00.000Z' }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
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

  it('sorts client-side ascending when orderAscending is true (oldest first)', async () => {
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [
        makeCustomEvent({ id: 'c', timestamp: '2025-01-15T10:10:00.000Z' }),
        makeCustomEvent({ id: 'a', timestamp: '2025-01-15T10:00:00.000Z' }),
        makeCustomEvent({ id: 'b', timestamp: '2025-01-15T10:05:00.000Z' }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const result = await fetchSessionLogCandidatesAsync({} as any, 'project-1', {
      eventName: 'login_pressed',
      orderAscending: true,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-02-01T00:00:00.000Z',
      limit: 25,
    });
    expect(result.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters out events without a sessionId', async () => {
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [
        makeCustomEvent({ id: 'a', sessionId: 'session-a' }),
        makeCustomEvent({ id: 'b', sessionId: null }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
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
