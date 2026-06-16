import JsonFile from '@expo/json-file';
import { Errors } from '@oclif/core';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { fetchSessionSecretAndUserAsync } from './fetchSessionSecretAndUser';
import { fetchSessionSecretAndUserFromBrowserAuthFlowAsync } from './fetchSessionSecretAndUserFromBrowserAuthFlow';
import { ApiV2Error } from '../ApiV2Error';
import { AnalyticsWithOrchestration } from '../analytics/AnalyticsManager';
import { ApiV2Client } from '../api';
import { createGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { CurrentUserQuery } from '../graphql/generated';
import { UserQuery } from '../graphql/queries/UserQuery';
import Log, { learnMore } from '../log';
import { promptAsync } from '../prompts';
import { getStateJsonPath } from '../utils/paths';

type UserSettingsData = {
  auth?: SessionData;
};

type SessionData = {
  sessionSecret: string;

  // These fields are potentially used by Expo CLI.
  userId: string;
  username: string;
  currentConnection: 'Username-Password-Authentication' | 'Browser-Flow-Authentication';
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

export default class SessionManager {
  private currentActor: Actor | undefined;

  constructor(private readonly analytics: AnalyticsWithOrchestration) {}

  public getAccessToken(): string | null {
    return process.env.EXPO_TOKEN ?? null;
  }

  public getSessionSecret(): string | null {
    return this.getSession()?.sessionSecret ?? null;
  }

  private getSession(): SessionData | null {
    try {
      return JsonFile.read<UserSettingsData>(getStateJsonPath())?.auth ?? null;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async setSessionAsync(sessionData?: SessionData): Promise<void> {
    await JsonFile.setAsync(getStateJsonPath(), 'auth', sessionData, {
      default: {},
      ensureDir: true,
    });
  }

  public async logoutAsync(): Promise<void> {
    const sessionSecret = this.getSessionSecret();
    if (sessionSecret) {
      const apiV2Client = new ApiV2Client({ accessToken: null, sessionSecret });
      try {
        await apiV2Client.postAsync('auth/logout', { body: {} });
      } catch (e) {
        // Best-effort: clear the local session even if the server request fails
        Log.debug('Failed to invalidate session secret on server:', e);
      }
    }
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
        await this.retryUsernamePasswordAuthWithOTPAsync(username, password);
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
  private async promptForOTPAsync(): Promise<string | null> {
    const enterMessage = `press ${chalk.bold('Enter')} to cancel`;
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
   * Handle the special case error indicating that a second-factor is required for authentication.
   */
  private async retryUsernamePasswordAuthWithOTPAsync(
    username: string,
    password: string
  ): Promise<void> {
    Log.log('One-time password from authenticator required.');
    const otp = await this.promptForOTPAsync();
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
