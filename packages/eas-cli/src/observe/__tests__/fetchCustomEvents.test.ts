import { AppObserveCustomEvent, AppObservePlatform } from '../../graphql/generated';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { fetchObserveCustomEventsAsync } from '../fetchCustomEvents';

jest.mock('../../graphql/queries/ObserveQuery');

function makeCustomEvent(overrides: Partial<AppObserveCustomEvent> = {}): AppObserveCustomEvent {
  return {
    __typename: 'AppObserveCustomEvent' as const,
    id: 'evt-1',
    eventName: 'my_event',
    timestamp: '2025-01-01T00:00:00.000Z',
    appVersion: '1.0.0',
    appBuildNumber: '1',
    deviceModel: 'iPhone 15',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    easClientId: 'client-1',
    properties: [],
    ...overrides,
  } as AppObserveCustomEvent;
}

describe('fetchObserveCustomEventsAsync', () => {
  const mockCustomEventListAsync = jest.mocked(ObserveQuery.customEventListAsync);
  const mockGraphqlClient = {} as any;

  beforeEach(() => {
    mockCustomEventListAsync.mockClear();
    mockCustomEventListAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
  });

  it('passes appId, time range, and limit to customEventListAsync', async () => {
    await fetchObserveCustomEventsAsync(mockGraphqlClient, 'project-123', {
      limit: 25,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(mockCustomEventListAsync).toHaveBeenCalledTimes(1);
    const callArgs = mockCustomEventListAsync.mock.calls[0][1];
    expect(callArgs.appId).toBe('project-123');
    expect(callArgs.first).toBe(25);
    expect(callArgs.filter?.startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(callArgs.filter?.endTime).toBe('2025-03-01T00:00:00.000Z');
  });

  it('forwards eventName filter when provided', async () => {
    await fetchObserveCustomEventsAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      eventName: 'my_event',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    const filter = mockCustomEventListAsync.mock.calls[0][1].filter;
    expect(filter?.eventName).toBe('my_event');
  });

  it('forwards platform, appVersion, and sessionId filters when provided', async () => {
    await fetchObserveCustomEventsAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      platform: AppObservePlatform.Ios,
      appVersion: '2.1.0',
      sessionId: 'session-xyz',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    const filter = mockCustomEventListAsync.mock.calls[0][1].filter;
    expect(filter?.platform).toBe(AppObservePlatform.Ios);
    expect(filter?.appVersion).toBe('2.1.0');
    expect(filter?.sessionId).toBe('session-xyz');
  });

  it('maps updateId to appUpdateId when provided', async () => {
    await fetchObserveCustomEventsAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      updateId: 'update-xyz',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    const filter = mockCustomEventListAsync.mock.calls[0][1].filter;
    expect(filter?.appUpdateId).toBe('update-xyz');
  });

  it('does not send appUpdateId when updateId is undefined', async () => {
    await fetchObserveCustomEventsAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    const filter = mockCustomEventListAsync.mock.calls[0][1].filter;
    expect(filter).not.toHaveProperty('appUpdateId');
  });

  it('does not send optional filters when their inputs are undefined', async () => {
    await fetchObserveCustomEventsAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    const filter = mockCustomEventListAsync.mock.calls[0][1].filter;
    expect(filter).not.toHaveProperty('eventName');
    expect(filter).not.toHaveProperty('platform');
    expect(filter).not.toHaveProperty('appVersion');
    expect(filter).not.toHaveProperty('appUpdateId');
    expect(filter).not.toHaveProperty('sessionId');
  });

  it('forwards after cursor when provided', async () => {
    await fetchObserveCustomEventsAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      after: 'cursor-abc',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(mockCustomEventListAsync.mock.calls[0][1].after).toBe('cursor-abc');
  });

  it('does not send after when not provided', async () => {
    await fetchObserveCustomEventsAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(mockCustomEventListAsync.mock.calls[0][1]).not.toHaveProperty('after');
  });

  it('returns the events and pageInfo from the underlying query', async () => {
    const events = [makeCustomEvent()];
    const pageInfo = { hasNextPage: true, hasPreviousPage: false, endCursor: 'cursor-end' };
    mockCustomEventListAsync.mockResolvedValue({ events, pageInfo });

    const result = await fetchObserveCustomEventsAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(result.events).toBe(events);
    expect(result.pageInfo).toBe(pageInfo);
  });
});
