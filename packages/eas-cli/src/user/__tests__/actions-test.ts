import ApiV2Error from '../../ApiV2Error';
import { promptAsync } from '../../prompts';
import { Actor, loginAsync } from '../User';
import { ensureActorHasUsername, showLoginPromptAsync } from '../actions';
import { UserSecondFactorDeviceMethod, retryUsernamePasswordAuthWithOTPAsync } from '../otp';

jest.mock('../../prompts');
jest.mock('../../api');
jest.mock('../otp');
jest.mock('../User', () => ({
  loginAsync: jest.fn(),
}));

beforeEach(() => {
  (promptAsync as jest.Mock).mockReset();
  (promptAsync as jest.Mock).mockImplementation(() => {
    throw new Error('Should not be called');
  });

  (loginAsync as jest.Mock).mockReset();
});

const userStub: Actor = {
  __typename: 'User',
  id: 'userId',
  username: 'username',
  accounts: [],
};

const robotStub: Actor = {
  __typename: 'Robot',
  id: 'userId',
  firstName: 'GLaDOS',
  accounts: [],
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
    (promptAsync as jest.Mock)
      .mockImplementationOnce(() => ({ username: 'hello', password: 'world' }))
      .mockImplementationOnce(() => ({ otp: '123456' }))
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });
    (loginAsync as jest.Mock)
      .mockImplementationOnce(async () => {
        throw new ApiV2Error({ code: 'testcode', request: {} } as any, {
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
      .mockImplementation(() => {});

    await showLoginPromptAsync();

    expect(retryUsernamePasswordAuthWithOTPAsync as jest.Mock).toHaveBeenCalledWith(
      'hello',
      'world',
      {
        secondFactorDevices: [
          {
            id: 'p0',
            is_primary: true,
            method: UserSecondFactorDeviceMethod.SMS,
            sms_phone_number: 'testphone',
          },
        ],
        smsAutomaticallySent: true,
      }
    );
  });
});
