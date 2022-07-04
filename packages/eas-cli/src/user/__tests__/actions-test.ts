import { ApiV2Error } from '../../api.js';
import { promptAsync } from '../../prompts.js';
import { Actor, loginAsync } from '../User.js';
import { ensureActorHasUsername, showLoginPromptAsync } from '../actions.js';
import { UserSecondFactorDeviceMethod, retryUsernamePasswordAuthWithOTPAsync } from '../otp.js';

jest.mock('../../prompts');
jest.mock('../../api', () => ({
  ApiV2Error: jest.requireActual('../../api').ApiV2Error,
}));

jest.mock('../otp');
jest.mock('../User', () => ({
  loginAsync: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(promptAsync).mockReset();
  jest.mocked(promptAsync).mockImplementation(async () => {
    throw new Error('Should not be called');
  });

  jest.mocked(loginAsync).mockReset();
});

const userStub: Actor = {
  __typename: 'User',
  id: 'userId',
  username: 'username',
  accounts: [],
  isExpoAdmin: false,
};

const robotStub: Actor = {
  __typename: 'Robot',
  id: 'userId',
  firstName: 'GLaDOS',
  accounts: [],
  isExpoAdmin: false,
};

describe('ensureActorHasUsername', () => {
  it('returns username for user actors', () => {
    expect(ensureActorHasUsername(userStub)).toBe(userStub.username);
  });

  it('throws for robot actors', () => {
    expect(() => ensureActorHasUsername(robotStub)).toThrow('not supported for robot');
  });
});

describe(showLoginPromptAsync, () => {
  it('prompts for OTP when 2FA is enabled', async () => {
    jest
      .mocked(promptAsync)
      .mockImplementationOnce(async () => ({ username: 'hello', password: 'world' }))
      .mockImplementationOnce(async () => ({ otp: '123456' }))
      .mockImplementation(async () => {
        throw new Error("shouldn't happen");
      });
    jest
      .mocked(loginAsync)
      .mockImplementationOnce(async () => {
        throw new ApiV2Error({
          message: 'An OTP is required',
          code: 'ONE_TIME_PASSWORD_REQUIRED',
          metadata: {
            secondFactorDevices: [
              {
                id: 'p0',
                is_primary: true,
                method: UserSecondFactorDeviceMethod.SMS,
                sms_phone_number: 'testphone',
              },
            ],
            smsAutomaticallySent: true,
          },
        });
      })
      .mockImplementation(async () => {});

    await showLoginPromptAsync();

    expect(retryUsernamePasswordAuthWithOTPAsync).toHaveBeenCalledWith('hello', 'world', {
      secondFactorDevices: [
        {
          id: 'p0',
          is_primary: true,
          method: UserSecondFactorDeviceMethod.SMS,
          sms_phone_number: 'testphone',
        },
      ],
      smsAutomaticallySent: true,
    });
  });
});
