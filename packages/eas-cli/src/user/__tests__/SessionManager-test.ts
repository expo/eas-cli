import fs from 'fs-extra';
import { vol } from 'memfs';
import path from 'path';

import { ApiV2Error } from '../../ApiV2Error';
import { AnalyticsWithOrchestration } from '../../analytics/AnalyticsManager';
import { ApiV2Client } from '../../api';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { getStateJsonPath } from '../../utils/paths';
import SessionManager from '../SessionManager';
import { fetchSessionSecretAndUserAsync } from '../fetchSessionSecretAndUser';
import { fetchSessionSecretAndUserFromBrowserAuthFlowAsync } from '../fetchSessionSecretAndUserFromBrowserAuthFlow';

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
jest.mock('../fetchSessionSecretAndUserFromBrowserAuthFlow');
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
  // Tests must not depend on the experimental flag being set in the ambient shell
  delete process.env.EAS_EXPERIMENTAL_ACCOUNT_SWITCHER;
});

afterEach(() => {
  process.env = OLD_ENV; // Restore old environment
});

describe(SessionManager, () => {
  describe('getActiveSession', () => {
    it('returns null when session is not stored', () => {
      const sessionManager = new SessionManager(analytics);
      expect(sessionManager['getActiveSession']()).toBeNull();
    });

    it('returns stored session data', async () => {
      await fs.mkdirp(path.dirname(getStateJsonPath()));
      await fs.writeJSON(getStateJsonPath(), { auth: authStub });
      const sessionManager = new SessionManager(analytics);
      expect(sessionManager['getActiveSession']()).toMatchObject(authStub);
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

  describe('browserLoginAsync', () => {
    it('saves user data to ~/.expo/state.json with sso', async () => {
      jest.mocked(fetchSessionSecretAndUserFromBrowserAuthFlowAsync).mockResolvedValue({
        sessionSecret: 'SESSION_SECRET',
        id: 'USER_ID',
        username: 'USERNAME',
      });
      const sessionManager = new SessionManager(analytics);
      await sessionManager['browserLoginAsync']({ sso: true });
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
      expect(fetchSessionSecretAndUserFromBrowserAuthFlowAsync).toHaveBeenCalledWith({ sso: true });
    });

    it('saves user data to ~/.expo/state.json without sso', async () => {
      jest.mocked(fetchSessionSecretAndUserFromBrowserAuthFlowAsync).mockResolvedValue({
        sessionSecret: 'SESSION_SECRET',
        id: 'USER_ID',
        username: 'USERNAME',
      });
      const sessionManager = new SessionManager(analytics);
      await sessionManager['browserLoginAsync']({ sso: false });
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
      expect(fetchSessionSecretAndUserFromBrowserAuthFlowAsync).toHaveBeenCalledWith({
        sso: false,
      });
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

    it('calls the server logout endpoint when session secret exists', async () => {
      jest.mocked(fetchSessionSecretAndUserAsync).mockResolvedValue({
        sessionSecret: 'SESSION_SECRET',
        id: 'USER_ID',
        username: 'USERNAME',
      });
      const apiV2PostSpy = jest.spyOn(ApiV2Client.prototype, 'postAsync');

      const sessionManager = new SessionManager(analytics);
      await sessionManager['loginAsync']({ username: 'USERNAME', password: 'PASSWORD' });
      await sessionManager.logoutAsync();

      expect(apiV2PostSpy).toHaveBeenCalledWith('auth/logout', { body: {} });
    });

    it('clears the local session even if the server logout call fails', async () => {
      jest.mocked(fetchSessionSecretAndUserAsync).mockResolvedValue({
        sessionSecret: 'SESSION_SECRET',
        id: 'USER_ID',
        username: 'USERNAME',
      });
      jest
        .spyOn(ApiV2Client.prototype, 'postAsync')
        .mockRejectedValueOnce(new Error('Network error'));

      const sessionManager = new SessionManager(analytics);
      await sessionManager['loginAsync']({ username: 'USERNAME', password: 'PASSWORD' });
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
          });
        })
        .mockResolvedValueOnce({
          sessionSecret: 'SESSION_SECRET',
          id: 'USER_ID',
          username: 'USERNAME',
        });

      await sessionManager.showLoginPromptAsync({ browser: false });

      expect(sessionManagerRetryUsernamePasswordAuthWithOTPAsyncSpy).toHaveBeenCalledWith(
        'hello',
        'world'
      );
    });

    it('calls regular login by default', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ username: 'USERNAME', password: 'PASSWORD' }))
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
        });

      jest.mocked(fetchSessionSecretAndUserAsync).mockResolvedValue({
        sessionSecret: 'SESSION_SECRET',
        id: 'USER_ID',
        username: 'USERNAME',
      });
      const sessionManager = new SessionManager(analytics);

      await sessionManager.showLoginPromptAsync();

      expect(fetchSessionSecretAndUserAsync).toHaveBeenCalled();
    });

    it('calls regular login when browser is false', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ username: 'USERNAME', password: 'PASSWORD' }))
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
        });

      const sessionManager = new SessionManager(analytics);

      await sessionManager.showLoginPromptAsync({ browser: false });
      expect(fetchSessionSecretAndUserAsync).toHaveBeenCalled();
    });

    it('calls regular login if the sso flag is false and browser is false', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ username: 'USERNAME', password: 'PASSWORD' }))
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
        });

      const sessionManager = new SessionManager(analytics);

      await sessionManager.showLoginPromptAsync({ sso: false, browser: false });
      expect(fetchSessionSecretAndUserAsync).toHaveBeenCalled();
    });

    it('calls SSO login if the sso flag is true', async () => {
      const sessionManager = new SessionManager(analytics);

      // SSO login
      await sessionManager.showLoginPromptAsync({ sso: true });
      expect(promptAsync).not.toHaveBeenCalled();
      expect(fetchSessionSecretAndUserFromBrowserAuthFlowAsync).toHaveBeenCalledWith({ sso: true });
    });

    it('calls browser login if the browser flag is true', async () => {
      const sessionManager = new SessionManager(analytics);

      // Browser login (not SSO)
      await sessionManager.showLoginPromptAsync({ browser: true });
      expect(promptAsync).not.toHaveBeenCalled();
      expect(fetchSessionSecretAndUserFromBrowserAuthFlowAsync).toHaveBeenCalledWith({
        sso: false,
      });
    });
  });

  describe('retryUsernamePasswordAuthWithOTPAsync', () => {
    it('shows authenticator OTP prompt', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ otp: 'hello' }))
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
        });
      const sessionManager = new SessionManager(analytics);
      const sessionManagerLoginAsyncSpy = jest.spyOn(sessionManager as any, 'loginAsync');

      await sessionManager['retryUsernamePasswordAuthWithOTPAsync']('blah', 'blah');

      expect(Log.log).toHaveBeenCalledWith('One-time password from authenticator required.');
      expect(sessionManagerLoginAsyncSpy).toHaveBeenCalledTimes(1);
    });

    it('exits when user bails', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({ otp: null }))
        .mockImplementation(() => {
          throw new Error("shouldn't happen");
        });

      const sessionManager = new SessionManager(analytics);

      await expect(
        sessionManager['retryUsernamePasswordAuthWithOTPAsync']('blah', 'blah')
      ).rejects.toThrowError('Cancelled login');
    });
  });

  describe('multi-account (EAS_EXPERIMENTAL_ACCOUNT_SWITCHER=1)', () => {
    const loginAsUserAsync = async (
      sessionManager: SessionManager,
      { id, username }: { id: string; username: string }
    ): Promise<void> => {
      jest.mocked(fetchSessionSecretAndUserAsync).mockResolvedValueOnce({
        sessionSecret: `SECRET_${id}`,
        id,
        username,
      });
      await sessionManager['loginAsync']({ username, password: 'PASSWORD' });
    };

    beforeEach(() => {
      process.env.EAS_EXPERIMENTAL_ACCOUNT_SWITCHER = '1';
    });

    it('migrates v0 state to v1 on login, preserving the old session and unrelated top-level keys', async () => {
      await fs.mkdirp(path.dirname(getStateJsonPath()));
      await fs.writeJSON(getStateJsonPath(), {
        uuid: 'SOME_UUID',
        auth: {
          sessionSecret: 'OLD_SECRET',
          userId: 'OLD_USER_ID',
          username: 'OLD_USERNAME',
          currentConnection: 'Username-Password-Authentication',
        },
      });

      const sessionManager = new SessionManager(analytics);
      await loginAsUserAsync(sessionManager, { id: 'USER_ID', username: 'USERNAME' });

      const state = await fs.readJSON(getStateJsonPath());
      expect(state.uuid).toBe('SOME_UUID');
      expect(state.version).toBe(1);
      expect(state.auth.activeAccountId).toBe('USER_ID');
      expect(Object.keys(state.auth.accounts).sort()).toEqual(['OLD_USER_ID', 'USER_ID']);
      expect(state.auth.sessionSecret).toBe('SECRET_USER_ID');
      expect(state.auth.username).toBe('USERNAME');
    });

    it('uses an account for the process without persisting a switch', async () => {
      const sessionManager = new SessionManager(analytics);
      await loginAsUserAsync(sessionManager, { id: 'ID_A', username: 'user-a' });
      await loginAsUserAsync(sessionManager, { id: 'ID_B', username: 'user-b' });

      expect(sessionManager['getSessionSecret']()).toBe('SECRET_ID_B');

      expect(sessionManager.useAccountForProcessByUsername('user-a')).toBe(true);
      expect(sessionManager['getSessionSecret']()).toBe('SECRET_ID_A');

      const state = await fs.readJSON(getStateJsonPath());
      expect(state.auth.activeAccountId).toBe('ID_B');
      expect(state.auth.sessionSecret).toBe('SECRET_ID_B');

      expect(sessionManager.useAccountForProcessByUsername('nonexistent')).toBe(false);
    });

    it('invalidates the session secret on the server when removing an account', async () => {
      const apiV2PostSpy = jest.spyOn(ApiV2Client.prototype, 'postAsync');
      const sessionManager = new SessionManager(analytics);
      await loginAsUserAsync(sessionManager, { id: 'ID_A', username: 'user-a' });
      await loginAsUserAsync(sessionManager, { id: 'ID_B', username: 'user-b' });

      await sessionManager.removeAccountAsync('ID_A');

      expect(apiV2PostSpy).toHaveBeenCalledWith('auth/logout', { body: {} });
      const state = await fs.readJSON(getStateJsonPath());
      expect(Object.keys(state.auth.accounts)).toEqual(['ID_B']);
      expect(state.auth.activeAccountId).toBe('ID_B');
    });

    it('invalidates all session secrets on the server when removing all accounts', async () => {
      const apiV2PostSpy = jest.spyOn(ApiV2Client.prototype, 'postAsync');
      const sessionManager = new SessionManager(analytics);
      await loginAsUserAsync(sessionManager, { id: 'ID_A', username: 'user-a' });
      await loginAsUserAsync(sessionManager, { id: 'ID_B', username: 'user-b' });

      await sessionManager.removeAllAccountsAsync();

      expect(apiV2PostSpy).toHaveBeenCalledTimes(2);
      const state = await fs.readJSON(getStateJsonPath());
      expect(state.auth.accounts).toEqual({});
      expect(state.auth.activeAccountId).toBeNull();
      expect(sessionManager['getSessionSecret']()).toBeNull();
    });

    it('keeps the v1 accounts map in sync when logging in with the flag off', async () => {
      const sessionManager = new SessionManager(analytics);
      await loginAsUserAsync(sessionManager, { id: 'ID_A', username: 'user-a' });

      delete process.env.EAS_EXPERIMENTAL_ACCOUNT_SWITCHER;
      await loginAsUserAsync(sessionManager, { id: 'ID_B', username: 'user-b' });

      const state = await fs.readJSON(getStateJsonPath());
      expect(state.auth.activeAccountId).toBe('ID_B');
      expect(Object.keys(state.auth.accounts).sort()).toEqual(['ID_A', 'ID_B']);

      // Re-enabling the flag must not resurrect the stale identity
      process.env.EAS_EXPERIMENTAL_ACCOUNT_SWITCHER = '1';
      expect(sessionManager['getActiveSession']()).toMatchObject({ userId: 'ID_B' });
    });

    it('preserves other stored accounts when logging out with the flag off', async () => {
      const sessionManager = new SessionManager(analytics);
      await loginAsUserAsync(sessionManager, { id: 'ID_A', username: 'user-a' });
      await loginAsUserAsync(sessionManager, { id: 'ID_B', username: 'user-b' });

      delete process.env.EAS_EXPERIMENTAL_ACCOUNT_SWITCHER;
      await sessionManager.logoutAsync();

      expect(sessionManager['getSessionSecret']()).toBeNull();
      const state = await fs.readJSON(getStateJsonPath());
      expect(state.auth.activeAccountId).toBeNull();
      expect(Object.keys(state.auth.accounts)).toEqual(['ID_A']);
      expect(state.auth.sessionSecret).toBeUndefined();
    });
  });
});
