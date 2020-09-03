import JsonFile from '@expo/json-file';
import { mkdirSync } from 'fs';
import * as path from 'path';

import { apiClient } from './utils/http';
import { DATA_PATH } from './utils/paths';

const SESSION_PATH = path.join(DATA_PATH, 'session.json');

export async function loginAsync({
  username,
  password,
}: {
  username: string;
  password: string;
}): Promise<any /* FIXME */> {
  try {
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
    console.log(sessionSecret);
  } catch (error) {
    if (error.response?.body?.errors) {
      for (const { message } of error.response?.body?.errors) {
        console.error(message);
      }
    } else console.log(error);
  }
}
