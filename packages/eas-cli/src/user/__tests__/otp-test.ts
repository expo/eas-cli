import { api } from '../../api.js';
import Log from '../../log.js';
import { promptAsync, selectAsync } from '../../prompts.js';
import { loginAsync } from '../User.js';
import { UserSecondFactorDeviceMethod, retryUsernamePasswordAuthWithOTPAsync } from '../otp.js';

jest.mock('../../prompts');
jest.mock('../../api');
jest.mock('../User', () => ({
  loginAsync: jest.fn(),
}));
jest.mock('../../log');

beforeEach(() => {
  jest.mocked(promptAsync).mockReset();
  jest.mocked(promptAsync).mockImplementation(async () => {
    throw new Error('Should not be called');
  });

  jest.mocked(selectAsync).mockReset();
  jest.mocked(selectAsync).mockImplementation(() => {
    throw new Error('Should not be called');
  });

  jest.mocked(loginAsync).mockReset();
  jest.mocked(Log.log).mockReset();
});

describe(retryUsernamePasswordAuthWithOTPAsync, () => {
  it('shows SMS OTP prompt when SMS is primary and code was automatically sent', async () => {
    jest
      .mocked(promptAsync)
      .mockImplementationOnce(async () => ({ otp: 'hello' }))
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    await retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
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

    expect(Log.log).toHaveBeenCalledWith(
      'One-time password was sent to the phone number ending in testphone.'
    );

    expect(jest.mocked(loginAsync)).toHaveBeenCalledTimes(1);
  });

  it('shows authenticator OTP prompt when authenticator is primary', async () => {
    jest
      .mocked(promptAsync)
      .mockImplementationOnce(async () => ({ otp: 'hello' }))
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    await retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
      secondFactorDevices: [
        {
          id: 'p0',
          is_primary: true,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: null,
        },
      ],
      smsAutomaticallySent: false,
    });

    expect(Log.log).toHaveBeenCalledWith('One-time password from authenticator required.');
    expect(jest.mocked(loginAsync)).toHaveBeenCalledTimes(1);
  });

  it('shows menu when user bails on primary', async () => {
    jest
      .mocked(promptAsync)
      .mockImplementationOnce(async () => ({ otp: null }))
      .mockImplementationOnce(async () => ({ otp: 'hello' })) // second time it is prompted after selecting backup code
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    jest
      .mocked(selectAsync)
      .mockImplementationOnce(async () => -1)
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    await retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
      secondFactorDevices: [
        {
          id: 'p0',
          is_primary: true,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: null,
        },
        {
          id: 'p2',
          is_primary: false,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: null,
        },
      ],
      smsAutomaticallySent: false,
    });

    expect(jest.mocked(selectAsync).mock.calls.length).toEqual(1);
    expect(jest.mocked(loginAsync)).toHaveBeenCalledTimes(1);
  });

  it('shows a warning when when user bails on primary and does not have any secondary set up', async () => {
    jest
      .mocked(promptAsync)
      .mockImplementationOnce(async () => ({ otp: null }))
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    await expect(
      retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
        secondFactorDevices: [
          {
            id: 'p0',
            is_primary: true,
            method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
            sms_phone_number: null,
          },
        ],
        smsAutomaticallySent: false,
      })
    ).rejects.toThrowError(
      'No other second-factor devices set up. Ensure you have set up and certified a backup device.'
    );
  });

  it('prompts for authenticator OTP when user selects authenticator secondary', async () => {
    jest
      .mocked(promptAsync)
      .mockImplementationOnce(async () => ({ otp: null }))
      .mockImplementationOnce(async () => ({ otp: 'hello' })) // second time it is prompted after selecting backup code
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    jest
      .mocked(selectAsync)
      .mockImplementationOnce(async () => -1)
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    await retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
      secondFactorDevices: [
        {
          id: 'p0',
          is_primary: true,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: null,
        },
        {
          id: 'p2',
          is_primary: false,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: null,
        },
      ],
      smsAutomaticallySent: false,
    });

    expect(jest.mocked(promptAsync).mock.calls.length).toBe(2); // first OTP, second OTP
  });

  it('requests SMS OTP and prompts for SMS OTP when user selects SMS secondary', async () => {
    jest
      .mocked(promptAsync)
      .mockImplementationOnce(async () => ({ otp: null }))
      .mockImplementationOnce(async () => ({ otp: 'hello' })) // second time it is prompted after selecting backup code
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    jest
      .mocked(selectAsync)
      .mockImplementationOnce(async () => 0)
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    jest
      .mocked(api.postAsync)
      .mockReturnValueOnce(Promise.resolve({ sessionSecret: 'SESSION_SECRET' }));

    await retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
      secondFactorDevices: [
        {
          id: 'p0',
          is_primary: true,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: null,
        },
        {
          id: 'p2',
          is_primary: false,
          method: UserSecondFactorDeviceMethod.SMS,
          sms_phone_number: 'wat',
        },
      ],
      smsAutomaticallySent: false,
    });

    expect(jest.mocked(promptAsync).mock.calls.length).toBe(2); // first OTP, second OTP
    expect(jest.mocked(api.postAsync).mock.calls[0]).toEqual([
      'auth/send-sms-otp',
      {
        body: {
          username: 'blah',
          password: 'blah',
          secondFactorDeviceID: 'p2',
        },
      },
    ]);
  });

  it('exits when user bails on primary and backup', async () => {
    jest
      .mocked(promptAsync)
      .mockImplementationOnce(async () => ({ otp: null }))
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    jest
      .mocked(selectAsync)
      .mockImplementationOnce(async () => -2)
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    await expect(
      retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
        secondFactorDevices: [
          {
            id: 'p0',
            is_primary: true,
            method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
            sms_phone_number: null,
          },
          {
            id: 'p2',
            is_primary: false,
            method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
            sms_phone_number: null,
          },
        ],
        smsAutomaticallySent: false,
      })
    ).rejects.toThrowError('Cancelled login');
  });
});
