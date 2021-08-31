import nullthrows from 'nullthrows';

import ApiV2Error from '../ApiV2Error';
import Log from '../log';
import { promptAsync } from '../prompts';
import { Actor, getUserAsync, loginAsync } from './User';
import { retryUsernamePasswordAuthWithOTPAsync } from './otp';

export async function showLoginPromptAsync(): Promise<void> {
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

export async function ensureLoggedInAsync(): Promise<Actor> {
  let user: Actor | undefined;
  try {
    user = await getUserAsync();
  } catch (_) {}

  if (!user) {
    Log.warn('An Expo user account is required to proceed.');
    Log.newLine();
    Log.log('Log in to EAS');
    await showLoginPromptAsync(); // TODO: login or register
    user = await getUserAsync();
  }

  return nullthrows(user);
}

export function ensureActorHasUsername(user: Actor): string {
  if (user.__typename === 'User') {
    return user.username;
  }
  throw new Error('This action is not supported for robot users.');
}
