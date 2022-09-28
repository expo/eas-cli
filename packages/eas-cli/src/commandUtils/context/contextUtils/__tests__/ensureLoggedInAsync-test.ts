import { ApiV2Error } from '../../../../api';
import { promptAsync } from '../../../../prompts';
import { loginAsync } from '../../../../user/User';
import {
  UserSecondFactorDeviceMethod,
  retryUsernamePasswordAuthWithOTPAsync,
} from '../../../../user/otp';
import { showLoginPromptAsync } from '../../contextUtils/ensureLoggedInAsync';

jest.mock('../../../../prompts');
jest.mock('../../../../api', () => ({
  ApiV2Error: jest.requireActual('../../../../api').ApiV2Error,
  getExpoApiBaseUrl: jest.fn(),
}));

jest.mock('../../../../user/otp');
jest.mock('../../../../user/User', () => ({
  loginAsync: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(promptAsync).mockReset();
  jest.mocked(promptAsync).mockImplementation(async () => {
    throw new Error('Should not be called');
  });

  jest.mocked(loginAsync).mockReset();
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
