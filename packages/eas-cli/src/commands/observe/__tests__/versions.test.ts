import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { AppPlatform } from '../../../graphql/generated';
import { fetchObserveVersionsAsync } from '../../../observe/fetchVersions';
import {
  buildObserveVersionsJson,
  buildObserveVersionsTable,
} from '../../../observe/formatVersions';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveVersions from '../versions';

jest.mock('../../../observe/fetchVersions');
jest.mock('../../../observe/formatVersions', () => ({
  buildObserveVersionsTable: jest.fn().mockReturnValue('table'),
  buildObserveVersionsJson: jest.fn().mockReturnValue([]),
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveVersionsAsync = jest.mocked(fetchObserveVersionsAsync);
const mockBuildObserveVersionsTable = jest.mocked(buildObserveVersionsTable);
const mockBuildObserveVersionsJson = jest.mocked(buildObserveVersionsJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

describe(ObserveVersions, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveVersionsAsync.mockResolvedValue([]);
  });

  function createCommand(argv: string[]): ObserveVersions {
    const command = new ObserveVersions(argv, mockConfig);
    // @ts-expect-error getContextAsync is a protected method
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('fetches versions with default parameters (both platforms)', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand([]);
    await command.runAsync();

    expect(mockFetchObserveVersionsAsync).toHaveBeenCalledTimes(1);
    const platforms = mockFetchObserveVersionsAsync.mock.calls[0][2];
    expect(platforms).toEqual([AppPlatform.Android, AppPlatform.Ios]);

    jest.useRealTimers();
  });

  it('queries only Android when --platform android is passed', async () => {
    const command = createCommand(['--platform', 'android']);
    await command.runAsync();

    const platforms = mockFetchObserveVersionsAsync.mock.calls[0][2];
    expect(platforms).toEqual([AppPlatform.Android]);
  });

  it('queries only iOS when --platform ios is passed', async () => {
    const command = createCommand(['--platform', 'ios']);
    await command.runAsync();

    const platforms = mockFetchObserveVersionsAsync.mock.calls[0][2];
    expect(platforms).toEqual([AppPlatform.Ios]);
  });

  it('uses default time range (60 days back) when no --start/--end flags', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand([]);
    await command.runAsync();

    const startTime = mockFetchObserveVersionsAsync.mock.calls[0][3];
    const endTime = mockFetchObserveVersionsAsync.mock.calls[0][4];
    expect(endTime).toBe('2025-06-15T12:00:00.000Z');
    expect(startTime).toBe('2025-04-16T12:00:00.000Z');

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

    const startTime = mockFetchObserveVersionsAsync.mock.calls[0][3];
    const endTime = mockFetchObserveVersionsAsync.mock.calls[0][4];
    expect(startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(endTime).toBe('2025-02-01T00:00:00.000Z');
  });

  it('defaults endTime to now when only --start is provided', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['--start', '2025-01-01T00:00:00.000Z']);
    await command.runAsync();

    const startTime = mockFetchObserveVersionsAsync.mock.calls[0][3];
    const endTime = mockFetchObserveVersionsAsync.mock.calls[0][4];
    expect(startTime).toBe('2025-01-01T00:00:00.000Z');
    expect(endTime).toBe('2025-06-15T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('uses --days to compute start/end time range', async () => {
    const now = new Date('2025-06-15T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['--days', '7']);
    await command.runAsync();

    const startTime = mockFetchObserveVersionsAsync.mock.calls[0][3];
    const endTime = mockFetchObserveVersionsAsync.mock.calls[0][4];
    expect(endTime).toBe('2025-06-15T12:00:00.000Z');
    expect(startTime).toBe('2025-06-08T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('rejects --days combined with --start', async () => {
    const command = createCommand(['--days', '7', '--start', '2025-01-01T00:00:00.000Z']);

    await expect(command.runAsync()).rejects.toThrow();
  });

  it('rejects --days combined with --end', async () => {
    const command = createCommand(['--days', '7', '--end', '2025-02-01T00:00:00.000Z']);

    await expect(command.runAsync()).rejects.toThrow();
  });

  it('passes the context project ID to fetchObserveVersionsAsync by default', async () => {
    const command = createCommand([]);
    await command.runAsync();

    const appId = mockFetchObserveVersionsAsync.mock.calls[0][1];
    expect(appId).toBe(projectId);
  });

  it('uses --project-id flag when provided', async () => {
    const command = createCommand(['--project-id', 'override-project-id']);
    await command.runAsync();

    const appId = mockFetchObserveVersionsAsync.mock.calls[0][1];
    expect(appId).toBe('override-project-id');
  });

  it('calls enableJsonOutput and printJsonOnlyOutput when --json is provided', async () => {
    mockFetchObserveVersionsAsync.mockResolvedValue([
      {
        platform: AppPlatform.Ios,
        appVersions: [
          {
            appVersion: '1.0.0',
            firstSeenAt: '2025-06-01T00:00:00.000Z',
            eventCount: 100,
            uniqueUserCount: 50,
            buildNumbers: [],
            updates: [],
            metrics: [],
          },
        ],
      },
    ]);

    const command = createCommand(['--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveVersionsJson).toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
  });

  it('does not call enableJsonOutput when --json is not provided', async () => {
    const command = createCommand([]);
    await command.runAsync();

    expect(mockEnableJsonOutput).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
  });

  it('calls buildObserveVersionsTable for non-json output', async () => {
    const command = createCommand([]);
    await command.runAsync();

    expect(mockBuildObserveVersionsTable).toHaveBeenCalled();
  });
});
