import { Config } from '@oclif/core';
import { vol } from 'memfs';

import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountUploadSessionType } from '../../../../graphql/generated';
import { AccountQuery } from '../../../../graphql/queries/AccountQuery';
import { selectAsync } from '../../../../prompts';
import { uploadAccountScopedFileAtPathToGCSAsync } from '../../../../uploads';
import { Actor } from '../../../../user/User';
import { sleepAsync } from '../../../../utils/promise';
import AccountAvatarSet from '../set';

jest.mock('fs');
jest.mock('../../../../graphql/queries/AccountQuery');
jest.mock('../../../../log');
jest.mock('../../../../ora', () => ({
  ora: jest.fn(() => {
    const spinner = {
      fail: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      succeed: jest.fn(),
    };
    spinner.start.mockReturnValue(spinner);
    return spinner;
  }),
}));
jest.mock('../../../../prompts');
jest.mock('../../../../uploads');
jest.mock('../../../../utils/promise');

const mockByIdProfileImageUrlAsync = jest.mocked(AccountQuery.byIdProfileImageUrlAsync);
const mockSelectAsync = jest.mocked(selectAsync);
const mockUploadAsync = jest.mocked(uploadAccountScopedFileAtPathToGCSAsync);
const mockSleepAsync = jest.mocked(sleepAsync);

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({
    failures: [],
    successes: [],
  });
  return config;
}

describe(AccountAvatarSet, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const personalAccount = { id: 'account-1', name: 'test-user' };
  const orgAccount = { id: 'account-2', name: 'test-org' };

  let now: number;

  beforeEach(() => {
    vol.reset();
    jest.clearAllMocks();

    now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockSleepAsync.mockImplementation(async ms => {
      now += ms;
    });

    mockByIdProfileImageUrlAsync
      .mockResolvedValueOnce('https://example.com/old.png')
      .mockResolvedValueOnce('https://example.com/new.png');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createCommand(
    argv: string[],
    accounts: { id: string; name: string }[]
  ): AccountAvatarSet {
    const command = new AccountAvatarSet(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient, actor: { accounts } as Actor },
    });
    return command;
  }

  it('uploads the avatar for the account passed as an argument', async () => {
    vol.fromJSON({ '/app/avatar.png': 'fake-png-bytes' });

    const command = createCommand(['/app/avatar.png', 'test-org'], [personalAccount, orgAccount]);
    await command.runAsync();

    expect(mockUploadAsync).toHaveBeenCalledWith(graphqlClient, {
      type: AccountUploadSessionType.ProfileImageUpload,
      accountId: orgAccount.id,
      path: '/app/avatar.png',
    });
    expect(mockSelectAsync).not.toHaveBeenCalled();
  });

  it('uses the only account without prompting', async () => {
    vol.fromJSON({ '/app/avatar.png': 'fake-png-bytes' });

    const command = createCommand(['/app/avatar.png'], [personalAccount]);
    await command.runAsync();

    expect(mockUploadAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ accountId: personalAccount.id })
    );
    expect(mockSelectAsync).not.toHaveBeenCalled();
  });

  it('prompts for an account when there are multiple', async () => {
    vol.fromJSON({ '/app/avatar.png': 'fake-png-bytes' });
    mockSelectAsync.mockResolvedValue(orgAccount);

    const command = createCommand(['/app/avatar.png'], [personalAccount, orgAccount]);
    await command.runAsync();

    expect(mockSelectAsync).toHaveBeenCalled();
    expect(mockUploadAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ accountId: orgAccount.id })
    );
  });

  it('throws in non-interactive mode with multiple accounts and no account name', async () => {
    vol.fromJSON({ '/app/avatar.png': 'fake-png-bytes' });

    const command = createCommand(
      ['/app/avatar.png', '--non-interactive'],
      [personalAccount, orgAccount]
    );
    await expect(command.runAsync()).rejects.toThrow(
      'ACCOUNT_NAME argument must be provided when running in `--non-interactive` mode.'
    );
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('throws for an account the user does not have access to', async () => {
    vol.fromJSON({ '/app/avatar.png': 'fake-png-bytes' });

    const command = createCommand(['/app/avatar.png', 'other-org'], [personalAccount, orgAccount]);
    await expect(command.runAsync()).rejects.toThrow(
      'Account "other-org" not found or you don\'t have access. Available accounts: test-user, test-org'
    );
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('throws when the file does not exist', async () => {
    const command = createCommand(['/app/missing.png', 'test-org'], [personalAccount, orgAccount]);
    await expect(command.runAsync()).rejects.toThrow('No file found at /app/missing.png');
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });
});
