import ApiV2Error from '../ApiV2Error';
import log from '../log';
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
    log.warn('An Expo user account is required to proceed.');
    log.newLine();
    log('Log in to EAS');
    await showLoginPromptAsync(); // TODO: login or register
    user = await getUserAsync();
    if (!user) {
      // just to satisfy ts
      throw new Error('Failed to access user data');
    }
  }

  return user;
}

/**
 * Resolve the name of the actor, either normal user or robot user.
 * This should be used whenever the "current user" needs to be displayed.
 * The display name CANNOT be used as project owner.
 */
export function getActorDisplayName(user?: Actor): string {
  switch (user?.__typename) {
    case 'User':
      return user.username;
    case 'Robot':
      return user.firstName ? `${user.firstName} (robot)` : 'robot';
    default:
      return 'anonymous';
  }
}

export function ensureActorHasUsername(user: Actor): string {
  if (user.__typename === 'User') {
    return user.username;
  }
  throw new Error('This action is not supported for robot users.');
}
