import fs from 'fs-extra';
import { vol } from 'memfs';
import path from 'path';

import { ApiV2Error } from '../../ApiV2Error';
import { AnalyticsWithOrchestration } from '../../analytics/AnalyticsManager';
import { ApiV2Client } from '../../api';
import Log from '../../log';
import { promptAsync, selectAsync } from '../../prompts';
import { getStateJsonPath } from '../../utils/paths';
import SessionManager, { UserSecondFactorDeviceMethod } from '../SessionManager';
import { fetchSessionSecretAndSsoUserAsync } from '../fetchSessionSecretAndSsoUser';
import { fetchSessionSecretAndUserAsync } from '../fetchSessionSecretAndUser';

jest.mock('../../prompts');
jest.mock('../../log');
jest.mock('fs');
jest.mock('../../graphql/queries/UserQuery', () => ({
  UserQuery: {
    currentUserAsync: async () => ({
      __typename: 'User',
      username: 'USERNAME',
      id: 'USER_ID',
    }),
  },
}));
jest.mock('../fetchSessionSecretAndUser');
jest.mock('../fetchSessionSecretAndSsoUser');
jest.mock('../../api');

const authStub: any = {
  sessionSecret: 'SESSION_SECRET',
  userId: 'USER_ID',
  username: 'USERNAME',
  currentConnection: 'Username-Password-Authentication',
};

const OLD_ENV = process.env;

const analytics: AnalyticsWithOrchestration = {
  logEvent: jest.fn((): void => {}),
  setActor: jest.fn((): void => {}),
  flushAsync: jest.fn(async (): Promise<void> => {}),
};

beforeEach(() => {
  vol.reset();
  jest.resetModules();
  jest.clearAllMocks();
  process.env = { ...OLD_ENV }; // Make a copy
});

afterEach(() => {
  process.env = OLD_ENV; // Restore old environment
});

describe(SessionManager, () => {
  describe('getSession', () => {
    it('returns null when session is not stored', () => {
      const sessionManager = new SessionManager(analytics);
      expect(sessionManager['getSession']()).toBeNull();
    });

    it('returns stored session data', async () => {
      await fs.mkdirp(path.dirname(getStateJsonPath()));
      await fs.writeJSON(getStateJsonPath(), { auth: authStub });
      const sessionManager = new SessionManager(analytics);
      expect(sessionManager['getSession']()).toMatchObject(authStub);
    });
  });

  describe('setSessionAsync', () => {
    it('stores empty session data', async () => {
      const sessionManager = new SessionManager(analytics);
      await sessionManager['setSessionAsync']();
      expect(await fs.pathExists(getStateJsonPath())).toBeTruthy();
    });

    it('stores actual session data', async () => {
      const sessionManager = new SessionManager(analytics);
      await sessionManager['setSessionAsync'](authStub);
      expect(await fs.readJSON(getStateJsonPath())).toMatchObject({ auth: authStub });
    });
  });

  describe('getAccessToken', () => {
    it('returns null when envvar is undefined', () => {
      const sessionManager = new SessionManager(analytics);
      expect(sessionManager['getAccessToken']()).toBeNull();
    });

    it('returns token when envar is defined', () => {
      process.env.EXPO_TOKEN = 'mytesttoken';
      const sessionManager = new SessionManager(analytics);
      expect(sessionManager['getAccessToken']()).toBe('mytesttoken');
    });
  });

  describe('getSessionSecret', () => {
    it('returns null when session is not stored', () => {
      const sessionManager = new SessionManager(analytics);
      expect(sessionManager['getSessionSecret']()).toBeNull();
    });

    it('returns secret when session is stored', async () => {
      const sessionManager = new SessionManager(analytics);
      await sessionManager['setSessionAsync'](authStub);
      expect(sessionManager['getSessionSecret']()).toBe(authStub.sessionSecret);
    });
  });

  describe('getUserAsync', () => {
    it('skips fetching user without access token or session secret', async () => {
      const sessionManager = new SessionManager(analytics);
      expect(await sessionManager.getUserAsync()).toBeUndefined();
    });

    it('fetches user when access token is defined', async () => {
      process.env.EXPO_TOKEN = 'accesstoken';
      const sessionManager = new SessionManager(analytics);
      expect(await sessionManager.getUserAsync()).toMatchObject({ __typename: 'User' });
    });

    it('fetches user when session secret is defined', async () => {
      const sessionManager = new SessionManager(analytics);
      await sessionManager['setSessionAsync']({
        sessionSecret: 'blah',
        userId: '1234',
        username: 'test',
        currentConnection: 'Username-Password-Authentication',
      });
      expect(await sessionManager.getUserAsync()).toMatchObject({ __typename: 'User' });
    });
  });

  describe('loginAsync', () => {
    it('saves user data to ~/.expo/state.json', async () => {
      jest.mocked(fetchSessionSecretAndUserAsync).mockResolvedValue({
        sessionSecret: 'SESSION_SECRET',
        id: 'USER_ID',
        username: 'USERNAME',
      });
      const sessionManager = new SessionManager(analytics);
      await sessionManager['loginAsync']({ username: 'USERNAME', password: 'PASSWORD' });
      expect(await fs.readFile(getStateJsonPath(), 'utf8')).toMatchInlineSnapshot(`
        "{
          "auth": {
            "sessionSecret": "SESSION_SECRET",
            "userId": "USER_ID",
            "username": "USERNAME",
            "currentConnection": "Username-Password-Authentication"
          }
        }
        "
      `);
    });
  });

  describe('ssoLoginAsync', () => {
    it('saves user data to ~/.expo/state.json', async () => {
      jest.mocked(fetchSessionSecretAndSsoUserAsync).mockResolvedValue({
        sessionSecret: 'SESSION_SECRET',
        id: 'USER_ID',
        username: 'USERNAME',
      });
      const sessionManager = new SessionManager(analytics);
      await sessionManager['ssoLoginAsync']();
      expect(await fs.readFile(getStateJsonPath(), 'utf8')).toMatchInlineSnapshot(`
        "{
          "auth": {
            "sessionSecret": "SESSION_SECRET",
            "userId": "USER_ID",
            "username": "USERNAME",
            "currentConnection": "Browser-Flow-Authentication"
          }
        }
        "
      `);
    });
  });

  describe('logoutAsync', () => {
    it('removes the session secret', async () => {
      jest.mocked(fetchSessionSecretAndUserAsync).mockResolvedValue({
        sessionSecret: 'SESSION_SECRET',
        id: 'USER_ID',
        username: 'USERNAME',
      });
      const sessionManager = new SessionManager(analytics);
      await sessionManager['loginAsync']({ username: 'USERNAME', password: 'PASSWORD' });

      expect(sessionManager['getSessionSecret']()).toBe('SESSION_SECRET');

      await sessionManager.logoutAsync();
      expect(sessionManager['getSessionSecret']()).toBe(null);
    });
  });

  describe('showLoginPromptAsync', () => {
    it('prompts for OTP when 2FA is enabled', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ username: 'hello', password: 'world' }))
        .mockImplementationOnce(async () => ({ otp: '123456' }))
        .mockImplementation(async () => {
          throw new Error("shouldn't happen");
        });

      const sessionManager = new SessionManager(analytics);
      const sessionManagerRetryUsernamePasswordAuthWithOTPAsyncSpy = jest.spyOn(
        sessionManager as any,
        'retryUsernamePasswordAuthWithOTPAsync'
      );

      jest
        .mocked(fetchSessionSecretAndUserAsync)
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
        .mockResolvedValueOnce({
          sessionSecret: 'SESSION_SECRET',
          id: 'USER_ID',
          username: 'USERNAME',
        });

      await sessionManager.showLoginPromptAsync();

      expect(sessionManagerRetryUsernamePasswordAuthWithOTPAsyncSpy).toHaveBeenCalledWith(
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

    it('calls regular login if the sso flag is false', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ username: 'USERNAME', password: 'PASSWORD' }))
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
        });

      const sessionManager = new SessionManager(analytics);

      // Regular login
      await sessionManager.showLoginPromptAsync({ sso: false });
      expect(fetchSessionSecretAndUserAsync).toHaveBeenCalled();
    });

    it('calls regular login if the sso flag is undefined', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ username: 'USERNAME', password: 'PASSWORD' }))
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
        });

      const sessionManager = new SessionManager(analytics);

      // Regular login
      await sessionManager.showLoginPromptAsync({ sso: undefined });
      expect(fetchSessionSecretAndUserAsync).toHaveBeenCalled();
    });

    it('calls SSO login if the sso flag is true', async () => {
      const sessionManager = new SessionManager(analytics);

      // SSO login
      await sessionManager.showLoginPromptAsync({ sso: true });
      expect(promptAsync).not.toHaveBeenCalled();
      expect(fetchSessionSecretAndSsoUserAsync).toHaveBeenCalled();
    });
  });

  describe('retryUsernamePasswordAuthWithOTPAsync', () => {
    it('shows SMS OTP prompt when SMS is primary and code was automatically sent', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ otp: 'hello' }))
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
        });
      const sessionManager = new SessionManager(analytics);
      const sessionManagerLoginAsyncSpy = jest.spyOn(sessionManager as any, 'loginAsync');

      await sessionManager['retryUsernamePasswordAuthWithOTPAsync']('blah', 'blah', {
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

      expect(sessionManagerLoginAsyncSpy).toHaveBeenCalledTimes(1);
    });

    it('shows authenticator OTP prompt when authenticator is primary', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ otp: 'hello' }))
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
        });
      const sessionManager = new SessionManager(analytics);
      const sessionManagerLoginAsyncSpy = jest.spyOn(sessionManager as any, 'loginAsync');

      await sessionManager['retryUsernamePasswordAuthWithOTPAsync']('blah', 'blah', {
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
      expect(sessionManagerLoginAsyncSpy).toHaveBeenCalledTimes(1);
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
      const sessionManager = new SessionManager(analytics);

      const sessionManagerLoginAsyncSpy = jest.spyOn(sessionManager as any, 'loginAsync');

      await sessionManager['retryUsernamePasswordAuthWithOTPAsync']('blah', 'blah', {
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
      expect(sessionManagerLoginAsyncSpy).toHaveBeenCalledTimes(1);
    });

    it('shows a warning when when user bails on primary and does not have any secondary set up', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ otp: null }))
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
        });
      const sessionManager = new SessionManager(analytics);

      await expect(
        sessionManager['retryUsernamePasswordAuthWithOTPAsync']('blah', 'blah', {
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
      const sessionManager = new SessionManager(analytics);

      await sessionManager['retryUsernamePasswordAuthWithOTPAsync']('blah', 'blah', {
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

      jest.mocked(fetchSessionSecretAndUserAsync).mockResolvedValue({
        sessionSecret: 'SESSION_SECRET',
        id: 'USER_ID',
        username: 'USERNAME',
      });
      const apiV2PostSpy = jest.spyOn(ApiV2Client.prototype, 'postAsync');

      const sessionManager = new SessionManager(analytics);
      await sessionManager['retryUsernamePasswordAuthWithOTPAsync']('blah', 'blah', {
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

      expect(apiV2PostSpy.mock.calls[0]).toEqual([
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
      const sessionManager = new SessionManager(analytics);

      await expect(
        sessionManager['retryUsernamePasswordAuthWithOTPAsync']('blah', 'blah', {
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
});
