import log from '../log';
import { prompt } from '../prompts';
import { User, getUserAsync, loginAsync } from './User';

export async function showLoginPromptAsync(): Promise<void> {
  const { username, password } = await prompt([
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
  await loginAsync({
    username,
    password,
  });
}

export async function ensureLoggedInAsync(): Promise<User> {
  let user: User | undefined;
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
