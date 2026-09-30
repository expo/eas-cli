import { getConfigFilePaths } from '@expo/config';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { findProjectRootAsync } from '../../../commandUtils/context/contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import {
  testAppQueryByIdResponse,
  testExperienceName,
  testProjectId,
} from '../../../credentials/__tests__/fixtures-constants';
import {
  BackgroundJobReceiptDataFragment,
  BackgroundJobResultType,
  BackgroundJobState,
} from '../../../graphql/generated';
import { AppMutation } from '../../../graphql/mutations/AppMutation';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import Log from '../../../log';
import { getPrivateExpoConfigAsync } from '../../../project/expoConfig';
import { promptAsync } from '../../../prompts';
import { isSudoModeRequiredError, promptForSudoModeUpgradeAsync } from '../../../user/sudo';
import { pollForBackgroundJobReceiptAsync } from '../../../utils/pollForBackgroundJobReceiptAsync';
import ProjectDelete from '../delete';

jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../graphql/mutations/AppMutation');
jest.mock('../../../utils/pollForBackgroundJobReceiptAsync');
jest.mock('../../../prompts');
jest.mock('../../../user/sudo');
jest.mock('../../../commandUtils/context/contextUtils/findProjectDirAndVerifyProjectSetupAsync');
jest.mock('../../../project/expoConfig');
jest.mock('@expo/config');
jest.mock('../../../log');
jest.mock('../../../ora', () => ({
  ora: () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }),
}));

describe(ProjectDelete, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  const mockReceipt: BackgroundJobReceiptDataFragment = {
    id: 'receipt-1',
    state: BackgroundJobState.Success,
    tries: 1,
    willRetry: false,
    resultId: null,
    resultType: BackgroundJobResultType.Void,
    resultData: null,
    errorCode: null,
    errorMessage: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  function createCommand(argv: string[], { insideProjectDir = true } = {}): ProjectDelete {
    if (insideProjectDir) {
      jest.mocked(findProjectRootAsync).mockResolvedValue('/app');
      jest
        .mocked(getConfigFilePaths)
        .mockReturnValue({ staticConfigPath: '/app/app.json', dynamicConfigPath: null });
      jest
        .mocked(getPrivateExpoConfigAsync)
        .mockResolvedValue({ extra: { eas: { projectId: testProjectId } } } as never);
    } else {
      jest
        .mocked(findProjectRootAsync)
        .mockRejectedValue(new Error('Run this command inside a project directory.'));
    }
    const command = new ProjectDelete(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      loggedIn: {
        graphqlClient,
        authenticationInfo: { accessToken: null, sessionSecret: 'session-secret' },
      },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.spyOn(Log, 'error').mockImplementation(() => {});
    jest.spyOn(Log, 'addNewLineIfNone').mockImplementation(() => {});
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});

    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
    jest.mocked(AppQuery.byFullNameAsync).mockResolvedValue(testAppQueryByIdResponse);
    jest.mocked(AppMutation.scheduleAppDeletionAsync).mockResolvedValue(mockReceipt);
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue(mockReceipt);
    jest.mocked(promptAsync).mockResolvedValue({ confirmedName: testExperienceName });
    jest.mocked(isSudoModeRequiredError).mockReturnValue(false);
  });

  it('deletes the project when the typed name matches', async () => {
    await createCommand([]).runAsync();

    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(testExperienceName),
      })
    );
    expect(AppMutation.scheduleAppDeletionAsync).toHaveBeenCalledWith(graphqlClient, testProjectId);
    expect(pollForBackgroundJobReceiptAsync).toHaveBeenCalledWith(graphqlClient, mockReceipt);
  });

  it('cancels deletion when the typed name does not match', async () => {
    jest.mocked(promptAsync).mockResolvedValue({ confirmedName: 'wrong-name' });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    await expect(createCommand([]).runAsync()).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(AppMutation.scheduleAppDeletionAsync).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('deletes without prompting when --dangerously-confirm-deletion matches the full name', async () => {
    await createCommand(['--dangerously-confirm-deletion', testExperienceName]).runAsync();

    expect(promptAsync).not.toHaveBeenCalled();
    expect(AppMutation.scheduleAppDeletionAsync).toHaveBeenCalledWith(graphqlClient, testProjectId);
  });

  it('throws when --dangerously-confirm-deletion does not match the full name', async () => {
    await expect(
      createCommand(['--dangerously-confirm-deletion', 'wrong-name']).runAsync()
    ).rejects.toThrow(/did not match the project's full name/);

    expect(promptAsync).not.toHaveBeenCalled();
    expect(AppMutation.scheduleAppDeletionAsync).not.toHaveBeenCalled();
  });

  it('deletes in non-interactive mode when --dangerously-confirm-deletion matches the full name', async () => {
    await createCommand([
      '--non-interactive',
      '--dangerously-confirm-deletion',
      testExperienceName,
    ]).runAsync();

    expect(promptAsync).not.toHaveBeenCalled();
    expect(AppMutation.scheduleAppDeletionAsync).toHaveBeenCalledWith(graphqlClient, testProjectId);
  });

  it('throws in non-interactive mode without --dangerously-confirm-deletion', async () => {
    await expect(createCommand(['--non-interactive']).runAsync()).rejects.toThrow(
      /requires passing --dangerously-confirm-deletion/
    );

    expect(AppMutation.scheduleAppDeletionAsync).not.toHaveBeenCalled();
  });

  it('deletes a project by full name argument outside a project directory', async () => {
    await createCommand(
      [
        testExperienceName,
        '--non-interactive',
        '--dangerously-confirm-deletion',
        testExperienceName,
      ],
      { insideProjectDir: false }
    ).runAsync();

    expect(AppQuery.byFullNameAsync).toHaveBeenCalledWith(graphqlClient, testExperienceName);
    expect(AppMutation.scheduleAppDeletionAsync).toHaveBeenCalledWith(graphqlClient, testProjectId);
  });

  it('deletes a project by ID argument', async () => {
    await createCommand([
      '00000000-0000-0000-0000-000000000001',
      '--non-interactive',
      '--dangerously-confirm-deletion',
      testExperienceName,
    ]).runAsync();

    expect(AppQuery.byIdAsync).toHaveBeenCalledWith(
      graphqlClient,
      '00000000-0000-0000-0000-000000000001'
    );
    expect(AppMutation.scheduleAppDeletionAsync).toHaveBeenCalledWith(graphqlClient, testProjectId);
  });

  it('throws outside a project directory when no argument is passed', async () => {
    await expect(createCommand([], { insideProjectDir: false }).runAsync()).rejects.toThrow(
      /No EAS project found in the current directory/
    );

    expect(AppMutation.scheduleAppDeletionAsync).not.toHaveBeenCalled();
  });

  it('throws when the current project has no EAS projectId configured, without offering to create one', async () => {
    const command = createCommand([]);
    jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({} as never);

    await expect(command.runAsync()).rejects.toThrow(
      /No EAS project found in the current directory/
    );

    expect(AppMutation.scheduleAppDeletionAsync).not.toHaveBeenCalled();
  });

  it('does not read or create an app config when the directory has none', async () => {
    const command = createCommand([]);
    jest
      .mocked(getConfigFilePaths)
      .mockReturnValue({ staticConfigPath: null, dynamicConfigPath: null });

    await expect(command.runAsync()).rejects.toThrow(
      /No EAS project found in the current directory/
    );

    expect(getPrivateExpoConfigAsync).not.toHaveBeenCalled();
    expect(AppMutation.scheduleAppDeletionAsync).not.toHaveBeenCalled();
  });

  it('propagates app config errors instead of reporting no project found', async () => {
    const command = createCommand([]);
    jest
      .mocked(getPrivateExpoConfigAsync)
      .mockRejectedValue(new Error('Invalid app config.\n"name" is required'));

    await expect(command.runAsync()).rejects.toThrow(/Invalid app config/);

    expect(AppMutation.scheduleAppDeletionAsync).not.toHaveBeenCalled();
  });

  it('upgrades the session to sudo mode and retries when the server requires it', async () => {
    const sudoError = new Error('sudo required');
    jest
      .mocked(AppMutation.scheduleAppDeletionAsync)
      .mockRejectedValueOnce(sudoError)
      .mockResolvedValueOnce(mockReceipt);
    jest.mocked(isSudoModeRequiredError).mockImplementation(e => e === sudoError);

    await createCommand([]).runAsync();

    expect(promptForSudoModeUpgradeAsync).toHaveBeenCalledWith({
      accessToken: null,
      sessionSecret: 'session-secret',
    });
    expect(AppMutation.scheduleAppDeletionAsync).toHaveBeenCalledTimes(2);
    expect(pollForBackgroundJobReceiptAsync).toHaveBeenCalledWith(graphqlClient, mockReceipt);
  });

  it('throws in non-interactive mode when sudo mode is required', async () => {
    const sudoError = new Error('sudo required');
    jest.mocked(AppMutation.scheduleAppDeletionAsync).mockRejectedValue(sudoError);
    jest.mocked(isSudoModeRequiredError).mockImplementation(e => e === sudoError);

    await expect(
      createCommand([
        '--non-interactive',
        '--dangerously-confirm-deletion',
        testExperienceName,
      ]).runAsync()
    ).rejects.toThrow(/requires a session in sudo mode/);

    expect(promptForSudoModeUpgradeAsync).not.toHaveBeenCalled();
  });
});
