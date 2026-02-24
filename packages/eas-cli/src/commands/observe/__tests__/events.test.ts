import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { fetchObserveEventsAsync } from '../../../observe/fetchEvents';
import ObserveEvents from '../events';

jest.mock('../../../observe/fetchEvents');
jest.mock('../../../observe/formatEvents', () => ({
  buildObserveEventsTable: jest.fn().mockReturnValue('table'),
  buildObserveEventsJson: jest.fn().mockReturnValue({}),
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveEventsAsync = jest.mocked(fetchObserveEventsAsync);

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
});
