import JsonFile from '@expo/json-file';

import { getStateJsonPath } from '../utils/paths';

type UserSettingsData = {
  auth?: SessionData;
};

type SessionData = {
  sessionSecret: string;

  // These fields are potentially used by Expo CLI.
  userId: string;
  username: string;
  currentConnection: 'Username-Password-Authentication';
};

export function getSession(): SessionData | null {
  try {
    return JsonFile.read<UserSettingsData>(getStateJsonPath())?.auth ?? null;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function setSessionAsync(sessionData?: SessionData): Promise<void> {
  await JsonFile.setAsync(getStateJsonPath(), 'auth', sessionData, {
    default: {},
    ensureDir: true,
  });
}
