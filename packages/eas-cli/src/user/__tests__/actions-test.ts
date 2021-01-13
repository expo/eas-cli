import { apiV2PostAsync } from '../../api';
import log from '../../log';
import { promptAsync, selectAsync } from '../../prompts';
import { Actor, loginAsync } from '../User';
import {
  UserSecondFactorDeviceMethod,
  ensureActorHasUsername,
  getActorDisplayName,
  retryUsernamePasswordAuthWithOTPAsync,
} from '../actions';

jest.mock('../../prompts');
jest.mock('../../api');
jest.mock('../User', () => ({
  loginAsync: jest.fn(),
}));

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

describe('getActorDisplayName', () => {
  it('returns anonymous for unauthenticated users', () => {
    expect(getActorDisplayName()).toBe('anonymous');
  });

  it('returns username for user actors', () => {
    expect(getActorDisplayName(userStub)).toBe(userStub.username);
  });

  it('returns firstName with robot prefix for robot actors', () => {
    expect(getActorDisplayName(robotStub)).toBe(`${robotStub.firstName} (robot)`);
  });

  it('returns robot prefix only for robot actors without firstName', () => {
    expect(getActorDisplayName({ ...robotStub, firstName: undefined })).toBe('robot');
  });
});

describe('ensureActorHasUsername', () => {
  it('returns username for user actors', () => {
    expect(ensureActorHasUsername(userStub)).toBe(userStub.username);
  });

  it('throws for robot actors', () => {
    expect(() => ensureActorHasUsername(robotStub)).toThrow('not supported for robot');
  });
});

describe(retryUsernamePasswordAuthWithOTPAsync, () => {
  it('shows SMS OTP prompt when SMS is primary and code was automatically sent', async () => {
    const logSpy = jest.spyOn(log, 'log').mockImplementation(() => {});

    (promptAsync as any)
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

    expect(logSpy.mock.calls[0][0]).toContain(
      'One-time password was sent to the phone number ending'
    );

    expect(loginAsync as jest.Mock).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
  });

  it('shows authenticator OTP prompt when authenticator is primary', async () => {
    const logSpy = jest.spyOn(log, 'log').mockImplementation(() => {});

    (promptAsync as any)
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

    expect(logSpy.mock.calls[0][0]).toEqual('One-time password from authenticator required.');
    expect(loginAsync as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('shows menu when user bails on primary', async () => {
    (promptAsync as any)
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
    (promptAsync as any)
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
    (promptAsync as any)
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

    expect((promptAsync as any).mock.calls.length).toBe(2); // first OTP, second OTP
  });

  it('requests SMS OTP and prompts for SMS OTP when user selects SMS secondary', async () => {
    (promptAsync as any)
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

    const postAsyncFn = jest.fn();
    (apiV2PostAsync as any).mockImplementationOnce(postAsyncFn).mockImplementation(() => {
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
          method: UserSecondFactorDeviceMethod.SMS,
          sms_phone_number: 'wat',
        },
      ],
      smsAutomaticallySent: false,
    });

    expect((promptAsync as any).mock.calls.length).toBe(2); // first OTP, second OTP
    expect(postAsyncFn.mock.calls[0]).toEqual([
      'auth/send-sms-otp',
      {
        username: 'blah',
        password: 'blah',
        secondFactorDeviceID: 'p2',
      },
    ]);
  });

  it('exits when user bails on primary and backup', async () => {
    (promptAsync as any)
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
