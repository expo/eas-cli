import JsonFile from '@expo/json-file';
import { Errors } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { fetchSessionSecretAndSsoUserAsync } from './fetchSessionSecretAndSsoUser';
import { fetchSessionSecretAndUserAsync } from './fetchSessionSecretAndUser';
import { ApiV2Error } from '../ApiV2Error';
import { AnalyticsWithOrchestration } from '../analytics/AnalyticsManager';
import { ApiV2Client } from '../api';
import { createGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { CurrentUserQuery } from '../graphql/generated';
import { UserQuery } from '../graphql/queries/UserQuery';
import Log, { learnMore } from '../log';
import { promptAsync, selectAsync } from '../prompts';
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

type LoggedInAuthenticationInfo =
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

    if (sso) {
      await this.ssoLoginAsync();
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

  private async ssoLoginAsync(): Promise<void> {
    const { sessionSecret, id, username } = await fetchSessionSecretAndSsoUserAsync();
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
