import { getMockOclifConfig } from '../../__tests__/commands/utils';
import { ChatResult, streamChatResponseAsync } from '../../chat/chatClient';
import { ChatReplInput, createChatReplInput } from '../../chat/replInput';
import * as flagsModule from '../../commandUtils/flags';
import { AppQuery } from '../../graphql/queries/AppQuery';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import Chat from '../chat';

jest.mock('../../chat/chatClient', () => ({
  ...jest.requireActual('../../chat/chatClient'),
  streamChatResponseAsync: jest.fn(),
}));
jest.mock('../../chat/replInput');
jest.mock('../../log');
jest.mock('../../utils/json');
jest.mock('../../graphql/queries/AppQuery', () => ({
  AppQuery: { byFullNameAsync: jest.fn() },
}));

const mockStreamChatResponseAsync = jest.mocked(streamChatResponseAsync);
const mockCreateChatReplInput = jest.mocked(createChatReplInput);
const mockAppByFullNameAsync = jest.mocked(AppQuery.byFullNameAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

const emptyResult: ChatResult = { text: 'ok', toolCalls: [] };

/** Builds a ChatReplInput whose askAsync yields the given lines in order, then `null`. */
function mockReplInput(lines: (string | null)[]): { askAsync: jest.Mock; close: jest.Mock } {
  const askAsync = jest.fn();
  for (const line of lines) {
    askAsync.mockResolvedValueOnce(line);
  }
  askAsync.mockResolvedValue(null);
  const input = { askAsync, close: jest.fn() };
  mockCreateChatReplInput.mockReturnValue(input as ChatReplInput);
  return input;
}

/** Forces interactive mode (jest runs without a TTY, which otherwise defaults to non-interactive). */
function forceInteractive(): void {
  jest
    .spyOn(flagsModule, 'resolveNonInteractiveAndJsonFlags')
    .mockReturnValue({ json: false, nonInteractive: false });
}

describe(Chat, () => {
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    mockStreamChatResponseAsync.mockResolvedValue(emptyResult);
  });

  function createCommand(
    argv: string[],
    {
      sessionSecret = '{"id":"session-id","version":"1"}',
      primaryAccountName = 'my-account',
    }: { sessionSecret?: string | null; primaryAccountName?: string } = {}
  ): Chat {
    const command = new Chat(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: {
        actor: {
          __typename: 'User',
          id: 'user-id',
          primaryAccount: { id: 'account-id', name: primaryAccountName },
          accounts: [{ id: 'account-id', name: primaryAccountName }],
        },
        graphqlClient: {},
        authenticationInfo: sessionSecret
          ? { accessToken: null, sessionSecret }
          : { accessToken: 'token', sessionSecret: null },
      },
    });
    return command;
  }

  it('sends the message for the primary account and does not prompt in non-interactive mode', async () => {
    const command = createCommand(['how are my builds?', '--non-interactive']);
    await command.runAsync();

    expect(mockStreamChatResponseAsync).toHaveBeenCalledTimes(1);
    const call = mockStreamChatResponseAsync.mock.calls[0][0];
    expect(call.accountName).toBe('my-account');
    expect(call.sessionSecret).toBe('{"id":"session-id","version":"1"}');
    expect(call.stream).toBe(true);
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].parts[0].text).toBe('how are my builds?');
    expect(mockCreateChatReplInput).not.toHaveBeenCalled();
  });

  it('prefers the --account flag over the primary account', async () => {
    const command = createCommand(['hi', '--account', 'other-account', '--non-interactive']);
    await command.runAsync();

    expect(mockStreamChatResponseAsync.mock.calls[0][0].accountName).toBe('other-account');
  });

  it('resolves --project to its owner account and frames the message', async () => {
    mockAppByFullNameAsync.mockResolvedValue({
      id: 'app1',
      fullName: '@acme/mobile',
      slug: 'mobile',
      ownerAccount: { id: 'acc', name: 'acme' },
    } as any);

    const command = createCommand([
      'is my build ok?',
      '--project',
      'acme/mobile',
      '--non-interactive',
    ]);
    await command.runAsync();

    expect(mockAppByFullNameAsync).toHaveBeenCalledWith(expect.anything(), '@acme/mobile');
    const call = mockStreamChatResponseAsync.mock.calls[0][0];
    expect(call.accountName).toBe('acme');
    expect(call.messages[0].parts[0].text).toBe(
      'Regarding the EAS project @acme/mobile: is my build ok?'
    );
  });

  it('throws a friendly error when --project cannot be found', async () => {
    mockAppByFullNameAsync.mockRejectedValue(new Error('not found'));
    const command = createCommand(['hi', '--project', 'acme/ghost', '--non-interactive']);
    await expect(command.runAsync()).rejects.toThrow(/@acme\/ghost was not found/);
  });

  it('continues the conversation with follow-up replies until the user types /exit', async () => {
    forceInteractive();
    mockStreamChatResponseAsync.mockResolvedValue({ text: 'answer', toolCalls: [] });
    const input = mockReplInput(['and my updates?', '/exit']);

    const command = createCommand(['how are my builds?']);
    await command.runAsync();

    expect(mockStreamChatResponseAsync).toHaveBeenCalledTimes(2);
    const secondCall = mockStreamChatResponseAsync.mock.calls[1][0];
    expect(secondCall.messages).toHaveLength(3);
    expect(secondCall.messages[1].role).toBe('assistant');
    expect(secondCall.messages[2].role).toBe('user');
    expect(secondCall.messages[2].parts[0].text).toBe('and my updates?');
    expect(input.close).toHaveBeenCalled();
  });

  it('exits when the input stream closes (Ctrl-D)', async () => {
    forceInteractive();
    mockReplInput([null]);

    const command = createCommand(['how are my builds?']);
    await command.runAsync();

    expect(mockStreamChatResponseAsync).toHaveBeenCalledTimes(1);
  });

  it('starts a new conversation with /clear', async () => {
    forceInteractive();
    mockStreamChatResponseAsync.mockResolvedValue({ text: 'answer', toolCalls: [] });
    mockReplInput(['/clear', 'fresh question', '/exit']);

    const command = createCommand(['first question']);
    await command.runAsync();

    expect(mockStreamChatResponseAsync).toHaveBeenCalledTimes(2);
    const secondCall = mockStreamChatResponseAsync.mock.calls[1][0];
    expect(secondCall.messages).toHaveLength(1);
    expect(secondCall.messages[0].parts[0].text).toBe('fresh question');
  });

  it('ignores unknown slash commands and keeps prompting', async () => {
    forceInteractive();
    mockStreamChatResponseAsync.mockResolvedValue({ text: 'answer', toolCalls: [] });
    mockReplInput(['/bogus', 'a real question', '/exit']);

    const command = createCommand(['first question']);
    await command.runAsync();

    expect(mockStreamChatResponseAsync).toHaveBeenCalledTimes(2);
    expect(mockStreamChatResponseAsync.mock.calls[1][0].messages[2].parts[0].text).toBe(
      'a real question'
    );
  });

  it('emits structured JSON and does not stream or prompt when --json is passed', async () => {
    mockStreamChatResponseAsync.mockResolvedValue({
      text: 'Your latest build passed.',
      toolCalls: [{ toolName: 'get_latest_builds', input: { limit: 1 }, output: { builds: [] } }],
    });

    const command = createCommand(['how are my builds?', '--json']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockStreamChatResponseAsync.mock.calls[0][0].stream).toBe(false);
    expect(mockCreateChatReplInput).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      message: 'how are my builds?',
      account: 'my-account',
      project: null,
      response: 'Your latest build passed.',
      toolCalls: [{ toolName: 'get_latest_builds', input: { limit: 1 }, output: { builds: [] } }],
    });
  });

  it('throws when authenticated with an access token instead of a session secret', async () => {
    const command = createCommand(['hi', '--non-interactive'], { sessionSecret: null });
    await expect(command.runAsync()).rejects.toThrow(/requires an interactive login/);
    expect(mockStreamChatResponseAsync).not.toHaveBeenCalled();
  });

  it('requires a message argument', async () => {
    const command = createCommand(['--non-interactive']);
    await expect(command.runAsync()).rejects.toThrow();
  });
});
