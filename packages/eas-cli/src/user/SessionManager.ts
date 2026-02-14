import JsonFile from '@expo/json-file';
import { Errors } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';
import path from 'path';

import { fetchSessionSecretAndUserAsync } from './fetchSessionSecretAndUser';
import { fetchSessionSecretAndUserFromBrowserAuthFlowAsync } from './fetchSessionSecretAndUserFromBrowserAuthFlow';
import { ApiV2Error } from '../ApiV2Error';
import { AnalyticsWithOrchestration } from '../analytics/AnalyticsManager';
import { ApiV2Client } from '../api';
import { createGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { CurrentUserQuery } from '../graphql/generated';
import { UserQuery } from '../graphql/queries/UserQuery';
import Log, { learnMore } from '../log';
import { promptAsync, selectAsync } from '../prompts';
import { isMultiAccountEnabled } from '../utils/easCli';
import { getStateJsonPath } from '../utils/paths';

type ConnectionType = 'Username-Password-Authentication' | 'Browser-Flow-Authentication';

/**
 * Legacy session data format (v0 schema).
 * These fields are also used for Expo CLI backward compatibility.
 */
type LegacySessionData = {
  sessionSecret: string;
  userId: string;
  username: string;
  currentConnection: ConnectionType;
};

/**
 * Account data with timestamps for multi-account support (v1 schema).
 */
type AccountData = {
  sessionSecret: string;
  userId: string;
  username: string;
  currentConnection: ConnectionType;
  addedAt: string;
  lastUsedAt: string;
};

/**
 * State file format for v0 (legacy single-account).
 */
type StateDataV0 = {
  auth?: LegacySessionData;
};

/**
 * State file format for v1 (multi-account).
 */
type StateDataV1 = {
  version: 1;
  auth: {
    activeAccountId: string | null;
    accounts: Record<string, AccountData>;
    // Legacy fields for Expo CLI backward compatibility
    sessionSecret?: string;
    userId?: string;
    username?: string;
    currentConnection?: ConnectionType;
  };
};

type StateData = StateDataV0 | StateDataV1;

type SessionData = LegacySessionData;

export enum UserSecondFactorDeviceMethod {
  AUTHENTICATOR = 'authenticator',
  SMS = 'sms',
}

type SecondFactorDevice = {
  id: string;
  method: UserSecondFactorDeviceMethod;
  sms_phone_number: string | null;
  is_primary: boolean;
};

export type LoggedInAuthenticationInfo =
  | {
      accessToken: string;
      sessionSecret: null;
    }
  | {
      accessToken: null;
      sessionSecret: string;
    };

type Actor = NonNullable<CurrentUserQuery['meActor']>;

/**
 * Publicly exposed account info for multi-account features.
 */
export type StoredAccount = {
  userId: string;
  username: string;
  isActive: boolean;
  addedAt?: string;
  lastUsedAt?: string;
};

export default class SessionManager {
  private currentActor: Actor | undefined;

  constructor(private readonly analytics: AnalyticsWithOrchestration) {}

  public getAccessToken(): string | null {
    return process.env.EXPO_TOKEN ?? null;
  }

  public getSessionSecret(): string | null {
    return this.getActiveSession()?.sessionSecret ?? null;
  }

  // ============================================
  // State File Reading
  // ============================================

  private readStateFile(): StateData | null {
    try {
      return JsonFile.read<StateData>(getStateJsonPath()) ?? null;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private isV1Schema(state: StateData | null): state is StateDataV1 {
    return (
      state !== null &&
      'version' in state &&
      state.version === 1 &&
      state.auth?.accounts !== undefined
    );
  }

  /**
   * Get the active session data, reading from appropriate schema.
   * For v1 schema, reads from the active account in the accounts object.
   * For v0 schema, reads from legacy fields.
   */
  private getActiveSession(): SessionData | null {
    const state = this.readStateFile();
    if (!state) {
      return null;
    }

    // For v1 schema with multi-account enabled, read from the active account
    if (isMultiAccountEnabled() && this.isV1Schema(state)) {
      const activeId = state.auth.activeAccountId;
      if (activeId && state.auth.accounts[activeId]) {
        const account = state.auth.accounts[activeId];
        return {
          sessionSecret: account.sessionSecret,
          userId: account.userId,
          username: account.username,
          currentConnection: account.currentConnection,
        };
      }
    }

    // Read from legacy fields (v0 schema or fallback)
    const auth = state.auth;
    if (!auth?.sessionSecret) {
      return null;
    }

    return {
      sessionSecret: auth.sessionSecret,
      userId: auth.userId!,
      username: auth.username!,
      currentConnection: auth.currentConnection!,
    };
  }

  // ============================================
  // State File Writing
  // ============================================

  /**
   * Write session data, preserving existing schema structure.
   * - If multi-account disabled: only update legacy fields
   * - If multi-account enabled: update accounts object + legacy fields
   */
  private async setSessionAsync(sessionData?: SessionData): Promise<void> {
    const statePath = getStateJsonPath();

    if (!sessionData) {
      // Logout: clear session data
      if (isMultiAccountEnabled()) {
        await this.clearActiveAccountAsync();
      } else {
        await JsonFile.setAsync(statePath, 'auth', undefined, {
          default: {},
          ensureDir: true,
        });
      }
      return;
    }

    if (!isMultiAccountEnabled()) {
      // Feature disabled: only update legacy fields, preserve any v1 structure
      const state = this.readStateFile() ?? {};
      const existingAuth = state.auth ?? {};

      const updatedAuth = {
        ...existingAuth,
        sessionSecret: sessionData.sessionSecret,
        userId: sessionData.userId,
        username: sessionData.username,
        currentConnection: sessionData.currentConnection,
      };

      await this.writeStateFileAsync({ ...state, auth: updatedAuth });
      return;
    }

    // Feature enabled: full v1 behavior
    await this.addOrUpdateAccountAsync(sessionData);
  }

  /**
   * Write state file atomically with proper permissions.
   */
  private async writeStateFileAsync(state: StateData): Promise<void> {
    const statePath = getStateJsonPath();
    const dir = path.dirname(statePath);
    await fs.ensureDir(dir);

    // Write atomically: write to temp file, then rename
    const tempPath = `${statePath}.tmp.${process.pid}`;
    await fs.writeJson(tempPath, state, { spaces: 2 });
    await fs.rename(tempPath, statePath);

    // Ensure restrictive permissions (owner read/write only)
    try {
      await fs.chmod(statePath, 0o600);
    } catch {
      // Ignore chmod errors on platforms that don't support it
    }
  }

  // ============================================
  // Multi-Account Methods (Feature Flag Gated)
  // ============================================

  /**
   * Get all stored accounts.
   * Returns single account array when multi-account is disabled.
   */
  public getAllAccounts(): StoredAccount[] {
    const state = this.readStateFile();

    if (!isMultiAccountEnabled() || !this.isV1Schema(state)) {
      // Return single account from legacy fields
      const session = this.getActiveSession();
      if (!session) {
        return [];
      }
      return [
        {
          userId: session.userId,
          username: session.username,
          isActive: true,
        },
      ];
    }

    // Multi-account enabled with v1 schema
    const accounts = Object.values(state.auth.accounts);
    const activeId = state.auth.activeAccountId;

    return accounts.map(account => ({
      userId: account.userId,
      username: account.username,
      isActive: account.userId === activeId,
      addedAt: account.addedAt,
      lastUsedAt: account.lastUsedAt,
    }));
  }

  /**
   * Check if a user is already logged in (by userId).
   */
  public isAccountLoggedIn(userId: string): boolean {
    const accounts = this.getAllAccounts();
    return accounts.some(a => a.userId === userId);
  }

  /**
   * Check if a user is already logged in (by username).
   */
  public isAccountLoggedInByUsername(username: string): boolean {
    const accounts = this.getAllAccounts();
    return accounts.some(a => a.username === username);
  }

  /**
   * Get the active account, or null if not logged in.
   */
  public getActiveAccount(): StoredAccount | null {
    const accounts = this.getAllAccounts();
    return accounts.find(a => a.isActive) ?? null;
  }

  /**
   * Add or update an account in multi-account mode.
   * If the account already exists (by userId), update its session.
   * Always sets the new/updated account as active.
   */
  private async addOrUpdateAccountAsync(sessionData: SessionData): Promise<void> {
    const state = this.readStateFile();
    const now = new Date().toISOString();

    let newState: StateDataV1;

    if (this.isV1Schema(state)) {
      // Update existing v1 schema
      const existingAccount = state.auth.accounts[sessionData.userId];
      newState = {
        version: 1,
        auth: {
          ...state.auth,
          activeAccountId: sessionData.userId,
          accounts: {
            ...state.auth.accounts,
            [sessionData.userId]: {
              sessionSecret: sessionData.sessionSecret,
              userId: sessionData.userId,
              username: sessionData.username,
              currentConnection: sessionData.currentConnection,
              addedAt: existingAccount?.addedAt ?? now,
              lastUsedAt: now,
            },
          },
          // Sync legacy fields
          sessionSecret: sessionData.sessionSecret,
          userId: sessionData.userId,
          username: sessionData.username,
          currentConnection: sessionData.currentConnection,
        },
      };
    } else {
      // Migrate from v0 to v1
      newState = {
        version: 1,
        auth: {
          activeAccountId: sessionData.userId,
          accounts: {
            [sessionData.userId]: {
              sessionSecret: sessionData.sessionSecret,
              userId: sessionData.userId,
              username: sessionData.username,
              currentConnection: sessionData.currentConnection,
              addedAt: now,
              lastUsedAt: now,
            },
          },
          // Sync legacy fields
          sessionSecret: sessionData.sessionSecret,
          userId: sessionData.userId,
          username: sessionData.username,
          currentConnection: sessionData.currentConnection,
        },
      };

      // If there was an existing session in v0, preserve it as a separate account
      if (state?.auth?.sessionSecret && state.auth.userId !== sessionData.userId) {
        newState.auth.accounts[state.auth.userId] = {
          sessionSecret: state.auth.sessionSecret,
          userId: state.auth.userId,
          username: state.auth.username,
          currentConnection: state.auth.currentConnection,
          addedAt: now,
          lastUsedAt: now,
        };
      }
    }

    await this.writeStateFileAsync(newState);
  }

  /**
   * Switch to a different account by userId.
   * Only available when multi-account is enabled.
   */
  public async switchAccountAsync(userId: string): Promise<void> {
    if (!isMultiAccountEnabled()) {
      throw new Error('Multi-account switching is not enabled');
    }

    const state = this.readStateFile();
    if (!this.isV1Schema(state)) {
      throw new Error('No accounts to switch to');
    }

    const account = state.auth.accounts[userId];
    if (!account) {
      throw new Error(`Account not found: ${userId}`);
    }

    const now = new Date().toISOString();
    const newState: StateDataV1 = {
      ...state,
      auth: {
        ...state.auth,
        activeAccountId: userId,
        accounts: {
          ...state.auth.accounts,
          [userId]: {
            ...account,
            lastUsedAt: now,
          },
        },
        // Sync legacy fields
        sessionSecret: account.sessionSecret,
        userId: account.userId,
        username: account.username,
        currentConnection: account.currentConnection,
      },
    };

    await this.writeStateFileAsync(newState);

    // Clear cached actor since we switched
    this.currentActor = undefined;
  }

  /**
   * Switch to a different account by username.
   * Only available when multi-account is enabled.
   */
  public async switchAccountByUsernameAsync(username: string): Promise<void> {
    if (!isMultiAccountEnabled()) {
      throw new Error('Multi-account switching is not enabled');
    }

    const state = this.readStateFile();
    if (!this.isV1Schema(state)) {
      throw new Error('No accounts to switch to');
    }

    const account = Object.values(state.auth.accounts).find(a => a.username === username);
    if (!account) {
      throw new Error(`Account not found: ${username}`);
    }

    await this.switchAccountAsync(account.userId);
  }

  /**
   * Remove an account by userId.
   * If removing the active account, switches to the most recently used remaining account.
   */
  public async removeAccountAsync(userId: string): Promise<void> {
    if (!isMultiAccountEnabled()) {
      // When disabled, just clear everything
      await JsonFile.setAsync(getStateJsonPath(), 'auth', undefined, {
        default: {},
        ensureDir: true,
      });
      this.currentActor = undefined;
      return;
    }

    const state = this.readStateFile();
    if (!this.isV1Schema(state)) {
      // V0 schema: just clear
      await JsonFile.setAsync(getStateJsonPath(), 'auth', undefined, {
        default: {},
        ensureDir: true,
      });
      this.currentActor = undefined;
      return;
    }

    const { [userId]: removed, ...remainingAccounts } = state.auth.accounts;
    if (!removed) {
      return; // Account not found, nothing to do
    }

    const wasActive = state.auth.activeAccountId === userId;
    let newActiveId: string | null = state.auth.activeAccountId;

    if (wasActive) {
      // Find the most recently used remaining account
      const remaining = Object.values(remainingAccounts);
      if (remaining.length > 0) {
        remaining.sort(
          (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
        );
        newActiveId = remaining[0].userId;
      } else {
        newActiveId = null;
      }
    }

    const newActiveAccount = newActiveId ? remainingAccounts[newActiveId] : null;

    const newState: StateDataV1 = {
      version: 1,
      auth: {
        activeAccountId: newActiveId,
        accounts: remainingAccounts,
        // Sync legacy fields to new active account (or clear if none)
        sessionSecret: newActiveAccount?.sessionSecret,
        userId: newActiveAccount?.userId,
        username: newActiveAccount?.username,
        currentConnection: newActiveAccount?.currentConnection,
      },
    };

    await this.writeStateFileAsync(newState);
    this.currentActor = undefined;
  }

  /**
   * Remove all accounts (logout all).
   */
  public async removeAllAccountsAsync(): Promise<void> {
    if (!isMultiAccountEnabled()) {
      await JsonFile.setAsync(getStateJsonPath(), 'auth', undefined, {
        default: {},
        ensureDir: true,
      });
      this.currentActor = undefined;
      return;
    }

    const state = this.readStateFile();
    if (!this.isV1Schema(state)) {
      await JsonFile.setAsync(getStateJsonPath(), 'auth', undefined, {
        default: {},
        ensureDir: true,
      });
      this.currentActor = undefined;
      return;
    }

    const newState: StateDataV1 = {
      version: 1,
      auth: {
        activeAccountId: null,
        accounts: {},
        // Clear legacy fields
        sessionSecret: undefined,
        userId: undefined,
        username: undefined,
        currentConnection: undefined,
      },
    };

    await this.writeStateFileAsync(newState);
    this.currentActor = undefined;
  }

  /**
   * Clear the active account (used by logout when multi-account enabled).
   */
  private async clearActiveAccountAsync(): Promise<void> {
    const state = this.readStateFile();

    if (!this.isV1Schema(state)) {
      // V0 schema: just clear
      await JsonFile.setAsync(getStateJsonPath(), 'auth', undefined, {
        default: {},
        ensureDir: true,
      });
      return;
    }

    const activeId = state.auth.activeAccountId;
    if (!activeId) {
      return; // Already no active account
    }

    await this.removeAccountAsync(activeId);
  }

  public async logoutAsync(): Promise<void> {
    this.currentActor = undefined;
    await this.setSessionAsync(undefined);
  }

  public async getUserAsync(): Promise<Actor | undefined> {
    if (!this.currentActor && (this.getAccessToken() || this.getSessionSecret())) {
      const authenticationInfo = {
        accessToken: this.getAccessToken(),
        sessionSecret: this.getSessionSecret(),
      };
      const actor = await UserQuery.currentUserAsync(createGraphqlClient(authenticationInfo));
      this.currentActor = actor ?? undefined;
      if (actor) {
        this.analytics.setActor(actor);
      }
    }
    return this.currentActor;
  }

  /**
   * Ensure that there is a logged-in actor. Show a login prompt if not.
   *
   * @param nonInteractive whether the log-in prompt if logged-out should be interactive
   * @returns logged-in Actor
   */
  public async ensureLoggedInAsync({
    nonInteractive,
  }: {
    nonInteractive: boolean;
  }): Promise<{ actor: Actor; authenticationInfo: LoggedInAuthenticationInfo }> {
    let actor: Actor | undefined;
    try {
      actor = await this.getUserAsync();
    } catch {}

    if (!actor) {
      Log.warn('An Expo user account is required to proceed.');
      await this.showLoginPromptAsync({ nonInteractive, printNewLine: true });
      actor = await this.getUserAsync();
    }

    const accessToken = this.getAccessToken();
    const authenticationInfo = accessToken
      ? {
          accessToken,
          sessionSecret: null,
        }
      : {
          accessToken: null,
          sessionSecret: nullthrows(this.getSessionSecret()),
        };

    return { actor: nullthrows(actor), authenticationInfo };
  }

  /**
   * Prompt the user to log in.
   *
   * @deprecated Should not be used outside of context functions, except in the AccountLogin command.
   */
  public async showLoginPromptAsync({
    nonInteractive = false,
    printNewLine = false,
    sso = false,
    browser = false,
  } = {}): Promise<void> {
    if (nonInteractive) {
      Errors.error(
        `Either log in with ${chalk.bold('eas login')} or set the ${chalk.bold(
          'EXPO_TOKEN'
        )} environment variable if you're using EAS CLI on CI (${learnMore(
          'https://docs.expo.dev/accounts/programmatic-access/',
          { dim: false }
        )})`
      );
    }
    if (printNewLine) {
      Log.newLine();
    }

    if (sso || browser) {
      await this.browserLoginAsync({ sso });
      return;
    }

    Log.log(
      `Log in to EAS with email or username (exit and run ${chalk.bold(
        'eas login --help'
      )} to see other login options)`
    );

    const { username, password } = await promptAsync([
      {
        type: 'text',
        name: 'username',
        message: 'Email or username',
      },
      {
        type: 'password',
        name: 'password',
        message: 'Password',
      },
    ]);
    try {
      await this.loginAsync({
        username,
        password,
      });
    } catch (e) {
      if (e instanceof ApiV2Error && e.expoApiV2ErrorCode === 'ONE_TIME_PASSWORD_REQUIRED') {
        await this.retryUsernamePasswordAuthWithOTPAsync(
          username,
          password,
          e.expoApiV2ErrorMetadata as any
        );
      } else {
        throw e;
      }
    }
  }

  private async browserLoginAsync({ sso = false }): Promise<void> {
    const { sessionSecret, id, username } = await fetchSessionSecretAndUserFromBrowserAuthFlowAsync(
      { sso }
    );
    await this.setSessionAsync({
      sessionSecret,
      userId: id,
      username,
      currentConnection: 'Browser-Flow-Authentication',
    });
  }

  private async loginAsync(input: {
    username: string;
    password: string;
    otp?: string;
  }): Promise<void> {
    const { sessionSecret, id, username } = await fetchSessionSecretAndUserAsync(input);
    await this.setSessionAsync({
      sessionSecret,
      userId: id,
      username,
      currentConnection: 'Username-Password-Authentication',
    });
  }

  /**
   * Prompt for an OTP with the option to cancel the question by answering empty (pressing return key).
   */
  private async promptForOTPAsync(cancelBehavior: 'cancel' | 'menu'): Promise<string | null> {
    const enterMessage =
      cancelBehavior === 'cancel'
        ? `press ${chalk.bold('Enter')} to cancel`
        : `press ${chalk.bold('Enter')} for more options`;
    const { otp } = await promptAsync({
      type: 'text',
      name: 'otp',
      message: `One-time password or backup code (${enterMessage}):`,
    });
    if (!otp) {
      return null;
    }

    return otp;
  }

  /**
   * Prompt for user to choose a backup OTP method. If selected method is SMS, a request
   * for a new OTP will be sent to that method. Then, prompt for the OTP, and retry the user login.
   */
  private async promptForBackupOTPAsync(
    username: string,
    password: string,
    secondFactorDevices: SecondFactorDevice[]
  ): Promise<string | null> {
    const nonPrimarySecondFactorDevices = secondFactorDevices.filter(device => !device.is_primary);

    if (nonPrimarySecondFactorDevices.length === 0) {
      throw new Error(
        'No other second-factor devices set up. Ensure you have set up and certified a backup device.'
      );
    }

    const hasAuthenticatorSecondFactorDevice = nonPrimarySecondFactorDevices.find(
      device => device.method === UserSecondFactorDeviceMethod.AUTHENTICATOR
    );

    const smsNonPrimarySecondFactorDevices = nonPrimarySecondFactorDevices.filter(
      device => device.method === UserSecondFactorDeviceMethod.SMS
    );

    const authenticatorChoiceSentinel = -1;
    const cancelChoiceSentinel = -2;

    const deviceChoices = smsNonPrimarySecondFactorDevices.map((device, idx) => ({
      title: device.sms_phone_number!,
      value: idx,
    }));

    if (hasAuthenticatorSecondFactorDevice) {
      deviceChoices.push({
        title: 'Authenticator',
        value: authenticatorChoiceSentinel,
      });
    }

    deviceChoices.push({
      title: 'Cancel',
      value: cancelChoiceSentinel,
    });

    const selectedValue = await selectAsync('Select a second-factor device:', deviceChoices);
    if (selectedValue === cancelChoiceSentinel) {
      return null;
    } else if (selectedValue === authenticatorChoiceSentinel) {
      return await this.promptForOTPAsync('cancel');
    }

    const device = smsNonPrimarySecondFactorDevices[selectedValue];

    // this is a logged-out endpoint
    const apiV2Client = new ApiV2Client({ accessToken: null, sessionSecret: null });
    await apiV2Client.postAsync('auth/send-sms-otp', {
      body: {
        username,
        password,
        secondFactorDeviceID: device.id,
      },
    });

    return await this.promptForOTPAsync('cancel');
  }

  /**
   * Handle the special case error indicating that a second-factor is required for
   * authentication.
   *
   * There are three cases we need to handle:
   * 1. User's primary second-factor device was SMS, OTP was automatically sent by the server to that
   *    device already. In this case we should just prompt for the SMS OTP (or backup code), which the
   *    user should be receiving shortly. We should give the user a way to cancel and the prompt and move
   *    to case 3 below.
   * 2. User's primary second-factor device is authenticator. In this case we should prompt for authenticator
   *    OTP (or backup code) and also give the user a way to cancel and move to case 3 below.
   * 3. User doesn't have a primary device or doesn't have access to their primary device. In this case
   *    we should show a picker of the SMS devices that they can have an OTP code sent to, and when
   *    the user picks one we show a prompt() for the sent OTP.
   */
  private async retryUsernamePasswordAuthWithOTPAsync(
    username: string,
    password: string,
    metadata: {
      secondFactorDevices?: SecondFactorDevice[];
      smsAutomaticallySent?: boolean;
    }
  ): Promise<void> {
    const { secondFactorDevices, smsAutomaticallySent } = metadata;
    assert(
      secondFactorDevices !== undefined && smsAutomaticallySent !== undefined,
      `Malformed OTP error metadata: ${metadata}`
    );

    const primaryDevice = secondFactorDevices.find(device => device.is_primary);
    let otp: string | null = null;

    if (smsAutomaticallySent) {
      assert(primaryDevice, 'OTP should only automatically be sent when there is a primary device');
      Log.log(
        `One-time password was sent to the phone number ending in ${primaryDevice.sms_phone_number}.`
      );
      otp = await this.promptForOTPAsync('menu');
    }

    if (primaryDevice?.method === UserSecondFactorDeviceMethod.AUTHENTICATOR) {
      Log.log('One-time password from authenticator required.');
      otp = await this.promptForOTPAsync('menu');
    }

    // user bailed on case 1 or 2, wants to move to case 3
    if (!otp) {
      otp = await this.promptForBackupOTPAsync(username, password, secondFactorDevices);
    }

    if (!otp) {
      throw new Error('Cancelled login');
    }

    await this.loginAsync({
      username,
      password,
      otp,
    });
  }
}
