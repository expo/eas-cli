import {
  AppObserveCustomEvent,
  AppObserveEvent,
  AppObserveEventsOrderByDirection,
  AppObserveEventsOrderByField,
  AppObservePlatform,
} from '../../graphql/generated';
import { fetchObserveCustomEventsAsync } from '../fetchCustomEvents';
import { fetchObserveEventsAsync } from '../fetchEvents';
import { fetchObserveSessionEventsAsync, fetchObserveSessionListAsync } from '../fetchSessions';

jest.mock('../fetchCustomEvents');
jest.mock('../fetchEvents');

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
  startTime: '2025-01-01T00:00:00.000Z',
  endTime: '2025-02-01T00:00:00.000Z',
  limit: 100,
};

describe('fetchObserveSessionListAsync', () => {
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

  it('queries both event sources with the provided window, ordered newest-first for metric events', async () => {
    await fetchObserveSessionListAsync({} as any, 'project-1', {
      ...baseOptions,
      platform: AppObservePlatform.Ios,
      appVersion: '1.0.0',
      updateId: 'update-xyz',
    });

    expect(mockFetchObserveEventsAsync).toHaveBeenCalledTimes(1);
    const metricOpts = mockFetchObserveEventsAsync.mock.calls[0][2];
    expect(metricOpts.startTime).toBe(baseOptions.startTime);
    expect(metricOpts.endTime).toBe(baseOptions.endTime);
    expect(metricOpts.limit).toBe(100);
    expect(metricOpts.platform).toBe(AppObservePlatform.Ios);
    expect(metricOpts.appVersion).toBe('1.0.0');
    expect(metricOpts.updateId).toBe('update-xyz');
    expect(metricOpts.orderBy).toEqual({
      field: AppObserveEventsOrderByField.Timestamp,
      direction: AppObserveEventsOrderByDirection.Desc,
    });

    expect(mockFetchObserveCustomEventsAsync).toHaveBeenCalledTimes(1);
    const customOpts = mockFetchObserveCustomEventsAsync.mock.calls[0][2];
    expect(customOpts.startTime).toBe(baseOptions.startTime);
    expect(customOpts.endTime).toBe(baseOptions.endTime);
    expect(customOpts.platform).toBe(AppObservePlatform.Ios);
  });

  it('combines metric and log events into per-session summaries with bounds', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [
        makeMetricEvent({ sessionId: 'session-1', timestamp: '2025-01-15T10:00:00.000Z' }),
        makeMetricEvent({ sessionId: 'session-1', timestamp: '2025-01-15T10:05:00.000Z' }),
        makeMetricEvent({ sessionId: 'session-2', timestamp: '2025-01-14T08:00:00.000Z' }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [
        makeCustomEvent({ sessionId: 'session-1', timestamp: '2025-01-15T10:02:00.000Z' }),
        makeCustomEvent({ sessionId: 'session-3', timestamp: '2025-01-16T11:00:00.000Z' }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const result = await fetchObserveSessionListAsync({} as any, 'project-1', baseOptions);

    expect(result.sessions).toHaveLength(3);
    const byId = new Map(result.sessions.map(s => [s.sessionId, s]));

    expect(byId.get('session-1')).toMatchObject({
      sessionId: 'session-1',
      firstSeenAt: '2025-01-15T10:00:00.000Z',
      lastSeenAt: '2025-01-15T10:05:00.000Z',
    });
    expect(byId.get('session-2')).toMatchObject({ sessionId: 'session-2' });
    expect(byId.get('session-3')).toMatchObject({ sessionId: 'session-3' });
  });

  it('sorts sessions by deviceOs, then app version desc, then firstSeenAt desc', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [
        makeMetricEvent({
          sessionId: 'ios-old',
          deviceOs: 'iOS',
          appVersion: '1.0.0',
          timestamp: '2025-01-10T10:00:00.000Z',
        }),
        makeMetricEvent({
          sessionId: 'ios-new-v2-early',
          deviceOs: 'iOS',
          appVersion: '2.0.0',
          timestamp: '2025-01-15T10:00:00.000Z',
        }),
        makeMetricEvent({
          sessionId: 'ios-new-v2-late',
          deviceOs: 'iOS',
          appVersion: '2.0.0',
          timestamp: '2025-01-20T10:00:00.000Z',
        }),
        makeMetricEvent({
          sessionId: 'android-v1',
          deviceOs: 'Android',
          appVersion: '1.5.0',
          timestamp: '2025-01-18T10:00:00.000Z',
        }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const result = await fetchObserveSessionListAsync({} as any, 'project-1', baseOptions);
    expect(result.sessions.map(s => s.sessionId)).toEqual([
      'android-v1',
      'ios-new-v2-late',
      'ios-new-v2-early',
      'ios-old',
    ]);
  });

  it('falls back to string comparison when app versions are not valid semver', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [
        makeMetricEvent({
          sessionId: 's-a',
          deviceOs: 'iOS',
          appVersion: 'beta-a',
          timestamp: '2025-01-10T10:00:00.000Z',
        }),
        makeMetricEvent({
          sessionId: 's-b',
          deviceOs: 'iOS',
          appVersion: 'beta-b',
          timestamp: '2025-01-10T10:00:00.000Z',
        }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const result = await fetchObserveSessionListAsync({} as any, 'project-1', baseOptions);
    // beta-b sorts before beta-a in desc order
    expect(result.sessions.map(s => s.sessionId)).toEqual(['s-b', 's-a']);
  });

  it('drops events that have no sessionId', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [makeMetricEvent({ sessionId: null })],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [makeCustomEvent({ sessionId: null })],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const result = await fetchObserveSessionListAsync({} as any, 'project-1', baseOptions);
    expect(result.sessions).toHaveLength(0);
    expect(result.scannedMetricEventCount).toBe(1);
    expect(result.scannedLogEventCount).toBe(1);
  });

  it('forwards eventName to the custom events filter when provided', async () => {
    await fetchObserveSessionListAsync({} as any, 'project-1', {
      ...baseOptions,
      eventName: 'login_pressed',
    });

    expect(mockFetchObserveCustomEventsAsync.mock.calls[0][2].eventName).toBe('login_pressed');
  });

  it('keeps only sessions that appear in the event-name-filtered custom events when eventName is set', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [
        makeMetricEvent({ sessionId: 'session-with-event', timestamp: '2025-01-15T10:00:00.000Z' }),
        makeMetricEvent({ sessionId: 'session-without', timestamp: '2025-01-14T08:00:00.000Z' }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [
        makeCustomEvent({
          sessionId: 'session-with-event',
          eventName: 'login_pressed',
          timestamp: '2025-01-15T10:02:00.000Z',
        }),
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const result = await fetchObserveSessionListAsync({} as any, 'project-1', {
      ...baseOptions,
      eventName: 'login_pressed',
    });

    expect(result.sessions.map(s => s.sessionId)).toEqual(['session-with-event']);
  });

  it('returns an empty session list when no log events match the event-name filter', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [makeMetricEvent({ sessionId: 'session-1' })],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    mockFetchObserveCustomEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    const result = await fetchObserveSessionListAsync({} as any, 'project-1', {
      ...baseOptions,
      eventName: 'never_fired',
    });
    expect(result.sessions).toEqual([]);
  });

  it('marks isTruncated when either underlying query has more pages', async () => {
    mockFetchObserveEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'm-cursor' },
    });
    const result = await fetchObserveSessionListAsync({} as any, 'project-1', baseOptions);
    expect(result.isTruncated).toBe(true);
  });
});

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
