import JsonFile from '@expo/json-file';
import { mkdirSync, unlinkSync } from 'fs';
import * as path from 'path';

import { apiClient } from './utils/api';
import { SESSION_PATH } from './utils/paths';

type Session = {
  sessionSecret: string;
};

export function getSessionSecret(): string | null {
  try {
    return JsonFile.read<Session>(SESSION_PATH)?.sessionSecret ?? null;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function getAccessToken(): string | null {
  return process.env.EXPO_TOKEN ?? null;
}

export async function loginAsync({
  username,
  password,
}: {
  username: string;
  password: string;
}): Promise<any /* FIXME */> {
  const body = await apiClient
    .post({
      url: 'auth/loginAsync',
      json: { username, password },
      responseType: 'json',
    })
    .json();
  const { sessionSecret } = (body as any).data;
  mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  await JsonFile.writeAsync(SESSION_PATH, { sessionSecret });
}

export async function logoutAsync() {
  if (getSessionSecret()) {
    unlinkSync(SESSION_PATH);
  }
}
