import JsonFileModule from '@expo/json-file';

import { getStateJsonPath } from '../utils/paths.js';

const JsonFile = JsonFileModule.default;

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
  } catch (error: any) {
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

export function getAccessToken(): string | null {
  return process.env.EXPO_TOKEN ?? null;
}

export function getSessionSecret(): string | null {
  return getSession()?.sessionSecret ?? null;
}
