import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { fetchObserveSessionEventsAsync } from '../../../observe/fetchSessions';
import {
  buildObserveSessionEventsJson,
  buildObserveSessionEventsTable,
} from '../../../observe/formatSessions';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveSession from '../session';

jest.mock('../../../observe/fetchSessions');
jest.mock('../../../observe/formatSessions', () => ({
  buildObserveSessionEventsTable: jest.fn().mockReturnValue('events-table'),
  buildObserveSessionEventsJson: jest.fn().mockReturnValue({}),
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveSessionEventsAsync = jest.mocked(fetchObserveSessionEventsAsync);
const mockBuildObserveSessionEventsTable = jest.mocked(buildObserveSessionEventsTable);
const mockBuildObserveSessionEventsJson = jest.mocked(buildObserveSessionEventsJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

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

  it('requires a session ID argument', async () => {
    const command = createCommand([]);
    await expect(command.runAsync()).rejects.toThrow();
    expect(mockFetchObserveSessionEventsAsync).not.toHaveBeenCalled();
  });

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

  it('emits JSON output when --json is set', async () => {
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
});
