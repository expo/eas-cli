import { Errors } from '@oclif/core';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { ApiV2Error } from '../../../api';
import Log, { learnMore } from '../../../log';
import { promptAsync } from '../../../prompts';
import { Actor, getUserAsync, loginAsync } from '../../../user/User';
import { retryUsernamePasswordAuthWithOTPAsync } from '../../../user/otp';

/**
 * Ensure that there is a logged-in actor. Show a login prompt if not.
 *
 * @param nonInteractive whether the log-in prompt if logged-out should be interactive
 * @returns logged-in Actor
 *
 * @deprecated Should not be used outside of context functions.
 */
export async function ensureLoggedInAsync({
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
    await showLoginPromptAsync({ nonInteractive, printNewLine: true });
    user = await getUserAsync();
  }

  return nullthrows(user);
}

/**
 * Prompt the user to log in.
 *
 * @deprecated Should not be used outside of context functions, except in the AccountLogin command.
 */
export async function showLoginPromptAsync({
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
