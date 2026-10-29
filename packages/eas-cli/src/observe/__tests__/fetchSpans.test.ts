import {
  AppObserveOrderDirection,
  AppObservePlatform,
  AppObserveSpanKind,
  AppObserveSpanListOrderByField,
  AppObserveSpanStatusCode,
} from '../../graphql/generated';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { fetchObserveSpansAsync } from '../fetchSpans';

jest.mock('../../graphql/queries/ObserveQuery');

describe(fetchObserveSpansAsync, () => {
  const mockSpanListAsync = jest.mocked(ObserveQuery.spanListAsync);
  const mockGraphqlClient = {} as any;

  beforeEach(() => {
    mockSpanListAsync.mockClear();
    mockSpanListAsync.mockResolvedValue({
      spans: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
  });

  it('passes appId, time range, and limit to spanListAsync', async () => {
    await fetchObserveSpansAsync(mockGraphqlClient, 'project-123', {
      limit: 25,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(mockSpanListAsync).toHaveBeenCalledTimes(1);
    const callArgs = mockSpanListAsync.mock.calls[0][1];
    expect(callArgs.appId).toBe('project-123');
    expect(callArgs.first).toBe(25);
    expect(callArgs.after).toBeUndefined();
    expect(callArgs.filter).toEqual({
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });
  });

  it('always asks for spans newest first', async () => {
    await fetchObserveSpansAsync(mockGraphqlClient, 'project-123', {
      limit: 25,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(mockSpanListAsync.mock.calls[0][1].orderBy).toEqual({
      field: AppObserveSpanListOrderByField.StartTimestamp,
      direction: AppObserveOrderDirection.Desc,
    });
  });

  it('maps every option to its filter key', async () => {
    await fetchObserveSpansAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      after: 'cursor-1',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      platforms: [AppObservePlatform.Ios],
      appVersion: '1.2.0',
      buildNumber: '42',
      updateId: 'update-1',
      environment: 'production',
      sessionId: 'session-1',
      names: ['GET', 'POST'],
      kinds: [AppObserveSpanKind.Client],
      statusCodes: [AppObserveSpanStatusCode.Error],
      hosts: ['api.example.com'],
      httpStatusCodes: [500, 502],
      minDurationMs: 250,
      rootOnly: true,
    });

    const callArgs = mockSpanListAsync.mock.calls[0][1];
    expect(callArgs.after).toBe('cursor-1');
    expect(callArgs.filter).toEqual({
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      platforms: [AppObservePlatform.Ios],
      appVersion: '1.2.0',
      appBuildNumber: '42',
      appUpdateId: 'update-1',
      environment: 'production',
      sessionId: 'session-1',
      names: ['GET', 'POST'],
      kinds: [AppObserveSpanKind.Client],
      statusCodes: [AppObserveSpanStatusCode.Error],
      hosts: ['api.example.com'],
      httpStatusCodes: [500, 502],
      minDurationMs: 250,
      rootOnly: true,
    });
  });

  it('sends a zero minimum duration and omits rootOnly when false', async () => {
    await fetchObserveSpansAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      minDurationMs: 0,
      rootOnly: false,
      names: [],
    });

    const filter = mockSpanListAsync.mock.calls[0][1].filter;
    expect(filter.minDurationMs).toBe(0);
    expect(filter).not.toHaveProperty('rootOnly');
    expect(filter).not.toHaveProperty('names');
  });

  it('returns the spans and pageInfo from the query', async () => {
    const span = { id: 'span-1' } as any;
    mockSpanListAsync.mockResolvedValue({
      spans: [span],
      pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'c' },
    });

    const result = await fetchObserveSpansAsync(mockGraphqlClient, 'project-123', {
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(result.spans).toEqual([span]);
    expect(result.pageInfo.endCursor).toBe('c');
  });
});
