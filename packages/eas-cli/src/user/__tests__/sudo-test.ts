import { promptForSudoModeUpgradeAsync } from '../sudo';
import { ApiV2Error } from '../../ApiV2Error';
import { ApiV2Client } from '../../api';
import { promptAsync } from '../../prompts';

jest.mock('../../api');
jest.mock('../../prompts');
jest.mock('../../log');

const authenticationInfo = { accessToken: null, sessionSecret: 'session-secret' } as const;

describe(promptForSudoModeUpgradeAsync, () => {
  let postAsync: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    postAsync = jest.fn().mockResolvedValue({ data: { status: 'success' } });
    jest.mocked(ApiV2Client).mockImplementation(() => ({ postAsync }) as unknown as ApiV2Client);
    jest.mocked(promptAsync).mockResolvedValue({ password: 'hunter2', otp: '123456' });
  });

  it('upgrades the session with the password', async () => {
    await promptForSudoModeUpgradeAsync(authenticationInfo);

    expect(postAsync).toHaveBeenCalledWith('auth/upgradeSudo', {
      body: { password: 'hunter2' },
    });
  });

  it('retries with an OTP when one is required', async () => {
    postAsync
      .mockRejectedValueOnce(
        new ApiV2Error({ message: 'otp required', code: 'ONE_TIME_PASSWORD_REQUIRED' })
      )
      .mockResolvedValueOnce({ data: { status: 'success' } });

    await promptForSudoModeUpgradeAsync(authenticationInfo);

    expect(postAsync).toHaveBeenCalledTimes(2);
    expect(postAsync).toHaveBeenLastCalledWith('auth/upgradeSudo', {
      body: { password: 'hunter2', otp: '123456' },
    });
  });

  it('rethrows other API errors', async () => {
    postAsync.mockRejectedValue(
      new ApiV2Error({ message: 'The password you entered is invalid', code: 'VALIDATION_ERROR' })
    );

    await expect(promptForSudoModeUpgradeAsync(authenticationInfo)).rejects.toThrow(
      /password you entered is invalid/
    );
  });

  it('throws for access-token sessions', async () => {
    await expect(
      promptForSudoModeUpgradeAsync({ accessToken: 'token', sessionSecret: null })
    ).rejects.toThrow(/Access tokens/);

    expect(postAsync).not.toHaveBeenCalled();
  });
});
