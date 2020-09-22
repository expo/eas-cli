import JsonFile from '@expo/json-file';

import { getStateJsonPath } from '../utils/paths';

type UserSettingsData = {
  auth: {
    sessionSecret: string;

    // These fields are potentially used by Expo CLI.
    userId: string;
    username: string;
    currentConnection: 'Username-Password-Authentication';
  };
};

export function getSessionSecret(): string | null {
  try {
    return JsonFile.read<UserSettingsData>(getStateJsonPath())?.auth?.sessionSecret ?? null;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function updateSessionSecretAsync(
  sessionSecret: string,
  userId: string,
  username: string
): Promise<void> {
  await JsonFile.setAsync(
    getStateJsonPath(),
    'auth',
    {
      sessionSecret,
      userId,
      username,
      currentConnection: 'Username-Password-Authentication',
    },
    { default: {}, ensureDir: true }
  );
}

export async function invalidateSessionAsync(): Promise<void> {
  await JsonFile.setAsync(getStateJsonPath(), 'auth', undefined, { default: {}, ensureDir: true });
}

export function getAccessToken(): string | null {
  return process.env.EXPO_TOKEN ?? null;
}
