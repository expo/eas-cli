import { Errors } from '@oclif/core';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { ApiV2Error } from '../../api';
import Log, { learnMore } from '../../log';
import { promptAsync } from '../../prompts';
import { Actor, getUserAsync, loginAsync } from '../../user/User';
import { retryUsernamePasswordAuthWithOTPAsync } from '../../user/otp';
import ContextField, { ContextOptions } from './ContextField';

export default class ActorContextField extends ContextField<Actor> {
  async getValueAsync({ nonInteractive }: ContextOptions): Promise<Actor> {
    return await ActorContextField.ensureLoggedInAsync({ nonInteractive });
  }

  private static async ensureLoggedInAsync({
    nonInteractive,
  }: {
    nonInteractive: boolean;
  }): Promise<Actor> {
    let user: Actor | undefined;
    try {
      user = await getUserAsync();
    } catch {}

    if (!user) {
      Log.warn('An Expo user account is required to proceed.');
      await this.showLoginPromptAsync({ nonInteractive, printNewLine: true });
      user = await getUserAsync();
    }

    return nullthrows(user);
  }

  private static async showLoginPromptAsync({
    nonInteractive = false,
    printNewLine = false,
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

    Log.log('Log in to EAS');

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
      await loginAsync({
        username,
        password,
      });
    } catch (e) {
      if (e instanceof ApiV2Error && e.expoApiV2ErrorCode === 'ONE_TIME_PASSWORD_REQUIRED') {
        await retryUsernamePasswordAuthWithOTPAsync(
          username,
          password,
          e.expoApiV2ErrorMetadata as any
        );
      } else {
        throw e;
      }
    }
  }
}
