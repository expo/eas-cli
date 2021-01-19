import { apiClient } from '../../api';
import { promptAsync, selectAsync } from '../../prompts';
import { loginAsync } from '../User';
import { UserSecondFactorDeviceMethod, retryUsernamePasswordAuthWithOTPAsync } from '../otp';

jest.mock('../../prompts');
jest.mock('../../api');
jest.mock('../User', () => ({
  loginAsync: jest.fn(),
}));

const logFn = jest.fn();
const mockLog = {
  __esModule: true, // this property makes it work
  default: logFn,
};
jest.mock('../../log', () => mockLog);

beforeEach(() => {
  (promptAsync as jest.Mock).mockReset();
  (promptAsync as jest.Mock).mockImplementation(() => {
    throw new Error('Should not be called');
  });

  (selectAsync as jest.Mock).mockReset();
  (selectAsync as jest.Mock).mockImplementation(() => {
    throw new Error('Should not be called');
  });

  (loginAsync as jest.Mock).mockReset();

  logFn.mockReset();
});

describe(retryUsernamePasswordAuthWithOTPAsync, () => {
  it('shows SMS OTP prompt when SMS is primary and code was automatically sent', async () => {
    (promptAsync as jest.Mock)
      .mockImplementationOnce(() => ({ otp: 'hello' }))
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

    expect(logFn).toHaveBeenCalledWith(
      'One-time password was sent to the phone number ending in testphone.'
    );

    expect(loginAsync as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('shows authenticator OTP prompt when authenticator is primary', async () => {
    (promptAsync as jest.Mock)
      .mockImplementationOnce(() => ({ otp: 'hello' }))
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    await retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
      secondFactorDevices: [
        {
          id: 'p0',
          is_primary: true,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: undefined,
        },
      ],
      smsAutomaticallySent: false,
    });

    expect(logFn).toHaveBeenCalledWith('One-time password from authenticator required.');
    expect(loginAsync as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('shows menu when user bails on primary', async () => {
    (promptAsync as jest.Mock)
      .mockImplementationOnce(() => ({ otp: null }))
      .mockImplementationOnce(() => ({ otp: 'hello' })) // second time it is prompted after selecting backup code
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    (selectAsync as any)
      .mockImplementationOnce(() => -1)
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    await retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
      secondFactorDevices: [
        {
          id: 'p0',
          is_primary: true,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: undefined,
        },
        {
          id: 'p2',
          is_primary: false,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: undefined,
        },
      ],
      smsAutomaticallySent: false,
    });

    expect((selectAsync as any).mock.calls.length).toEqual(1);
    expect(loginAsync as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('shows a warning when when user bails on primary and does not have any secondary set up', async () => {
    (promptAsync as jest.Mock)
      .mockImplementationOnce(() => ({ otp: null }))
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
            sms_phone_number: undefined,
          },
        ],
        smsAutomaticallySent: false,
      })
    ).rejects.toThrowError(
      'No other second-factor devices set up. Ensure you have set up and certified a backup device.'
    );
  });

  it('prompts for authenticator OTP when user selects authenticator secondary', async () => {
    (promptAsync as jest.Mock)
      .mockImplementationOnce(() => ({ otp: null }))
      .mockImplementationOnce(() => ({ otp: 'hello' })) // second time it is prompted after selecting backup code
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    (selectAsync as any)
      .mockImplementationOnce(() => -1)
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    await retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
      secondFactorDevices: [
        {
          id: 'p0',
          is_primary: true,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: undefined,
        },
        {
          id: 'p2',
          is_primary: false,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: undefined,
        },
      ],
      smsAutomaticallySent: false,
    });

    expect((promptAsync as jest.Mock).mock.calls.length).toBe(2); // first OTP, second OTP
  });

  it('requests SMS OTP and prompts for SMS OTP when user selects SMS secondary', async () => {
    (promptAsync as jest.Mock)
      .mockImplementationOnce(() => ({ otp: null }))
      .mockImplementationOnce(() => ({ otp: 'hello' })) // second time it is prompted after selecting backup code
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    (selectAsync as any)
      .mockImplementationOnce(() => 0)
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    (apiClient.post as jest.Mock).mockReturnValueOnce({
      json: () => Promise.resolve({ data: { sessionSecret: 'SESSION_SECRET' } }),
    });

    await retryUsernamePasswordAuthWithOTPAsync('blah', 'blah', {
      secondFactorDevices: [
        {
          id: 'p0',
          is_primary: true,
          method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
          sms_phone_number: undefined,
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

    expect((promptAsync as jest.Mock).mock.calls.length).toBe(2); // first OTP, second OTP
    expect((apiClient.post as jest.Mock).mock.calls[0]).toEqual([
      'auth/send-sms-otp',
      {
        json: {
          username: 'blah',
          password: 'blah',
          secondFactorDeviceID: 'p2',
        },
      },
    ]);
  });

  it('exits when user bails on primary and backup', async () => {
    (promptAsync as jest.Mock)
      .mockImplementationOnce(() => ({ otp: null }))
      .mockImplementation(() => {
        throw new Error("shouldn't happen");
      });

    (selectAsync as any)
      .mockImplementationOnce(() => -2)
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
            sms_phone_number: undefined,
          },
          {
            id: 'p2',
            is_primary: false,
            method: UserSecondFactorDeviceMethod.AUTHENTICATOR,
            sms_phone_number: undefined,
          },
        ],
        smsAutomaticallySent: false,
      })
    ).rejects.toThrowError('Cancelled login');
  });
});
