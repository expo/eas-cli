import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { EmbeddedUpdateMutation } from '../../../../graphql/mutations/EmbeddedUpdateMutation';
import Log from '../../../../log';
import * as prompts from '../../../../prompts';
import * as json from '../../../../utils/json';
import UpdateEmbeddedDelete from '../delete';

jest.mock('../../../../graphql/mutations/EmbeddedUpdateMutation', () => ({
  EmbeddedUpdateMutation: { deleteEmbeddedUpdateAsync: jest.fn() },
}));
jest.mock('../../../../log');
jest.mock('../../../../utils/json');
jest.mock('../../../../prompts');

const mockDelete = jest.mocked(EmbeddedUpdateMutation.deleteEmbeddedUpdateAsync);
const mockToggleConfirm = jest.mocked(prompts.toggleConfirmAsync);
const mockLogLog = jest.mocked(Log.log);
const mockLogWithTick = jest.mocked(Log.withTick);
const mockLogError = jest.mocked(Log.error);
const mockEnableJsonOutput = jest.mocked(json.enableJsonOutput);
const mockPrintJson = jest.mocked(json.printJsonOnlyOutput);

const VALID_UUID = 'a1b2c3d4-1234-4000-8000-000000000000';

const MOCK_CONTEXT = {
  loggedIn: { graphqlClient: {} as ExpoGraphqlClient },
};

describe(UpdateEmbeddedDelete, () => {
  const mockConfig = getMockOclifConfig();
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDelete.mockResolvedValue({ id: VALID_UUID });
    mockToggleConfirm.mockResolvedValue(true);
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  afterEach(() => {
    processExitSpy.mockRestore();
  });

  function createCommand(argv: string[]): UpdateEmbeddedDelete {
    const command = new UpdateEmbeddedDelete(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue(MOCK_CONTEXT);
    return command;
  }

  it('deletes when the user confirms', async () => {
    await createCommand([VALID_UUID]).run();

    expect(mockToggleConfirm).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      id: VALID_UUID,
    });
    expect(mockLogWithTick).toHaveBeenCalledWith(`Deleted embedded update ${VALID_UUID}`);
  });

  it('skips confirmation in non-interactive mode', async () => {
    await createCommand([VALID_UUID, '--non-interactive']).run();

    expect(mockToggleConfirm).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      id: VALID_UUID,
    });
  });

  it('aborts (process.exit) without calling the mutation when the user declines', async () => {
    mockToggleConfirm.mockResolvedValue(false);
    await expect(createCommand([VALID_UUID]).run()).rejects.toThrow('process.exit');

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockLogWithTick).not.toHaveBeenCalled();
  });

  it('--json prints { id } and skips the human-readable success line', async () => {
    await createCommand([VALID_UUID, '--non-interactive', '--json']).run();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockPrintJson).toHaveBeenCalledWith({ id: VALID_UUID });
    expect(mockLogWithTick).not.toHaveBeenCalled();
  });

  it('rethrows unexpected mutation errors', async () => {
    const boom = new Error('boom');
    mockDelete.mockRejectedValue(boom);
    await expect(createCommand([VALID_UUID, '--non-interactive']).run()).rejects.toThrow('boom');
  });

  it('succeeds for an unknown id (server best-effort)', async () => {
    // Server returns { id } even when nothing was deleted, so we should still tick.
    await createCommand([VALID_UUID, '--non-interactive']).run();
    expect(mockLogWithTick).toHaveBeenCalledWith(`Deleted embedded update ${VALID_UUID}`);
  });

  it('prints an explanatory message before prompting (interactive)', async () => {
    await createCommand([VALID_UUID]).run();
    const lines = mockLogLog.mock.calls.map(c => String(c[0])).join('\n');
    expect(lines).toContain(`permanently delete embedded update: "${VALID_UUID}"`);
    expect(lines).toContain('Diff patches already generated');
    expect(lines).toContain('re-upload');
  });

  it('logs a cancel message when the user declines', async () => {
    mockToggleConfirm.mockResolvedValue(false);
    await expect(createCommand([VALID_UUID]).run()).rejects.toThrow('process.exit');
    expect(mockLogError).toHaveBeenCalledWith(
      `Canceled deletion of embedded update: "${VALID_UUID}".`
    );
  });

  it('passes the id through to deleteEmbeddedUpdateAsync', async () => {
    await createCommand([VALID_UUID, '--non-interactive']).run();
    expect(mockDelete).toHaveBeenCalledWith(MOCK_CONTEXT.loggedIn.graphqlClient, {
      id: VALID_UUID,
    });
  });

  it('--json + --non-interactive: skips prompt, skips tick, prints { id }', async () => {
    await createCommand([VALID_UUID, '--non-interactive', '--json']).run();
    expect(mockToggleConfirm).not.toHaveBeenCalled();
    expect(mockLogWithTick).not.toHaveBeenCalled();
    expect(mockPrintJson).toHaveBeenCalledWith({ id: VALID_UUID });
  });
});
