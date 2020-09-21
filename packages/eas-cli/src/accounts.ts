import JsonFile from '@expo/json-file';
import gql from 'graphql-tag';

import { apiClient, graphqlClient } from './utils/api';
import { getSettingsDirectory } from './utils/paths';

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
    return JsonFile.read<UserSettingsData>(getSettingsDirectory())?.auth?.sessionSecret ?? null;
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
  const result = await graphqlClient
    .query(
      gql`
        {
          viewer {
            id
            username
          }
        }
      `,
      {},
      {
        fetchOptions: {
          headers: {
            'expo-session': sessionSecret,
          },
        },
      }
    )
    .toPromise();
  const { data } = result;
  await JsonFile.setAsync(
    getSettingsDirectory(),
    'auth',
    {
      sessionSecret,
      userId: data.viewer.id,
      username: data.viewer.username,
      currentConnection: 'Username-Password-Authentication',
    },
    { default: {} }
  );
}

export async function logoutAsync() {
  await JsonFile.setAsync(getSettingsDirectory(), 'auth', undefined, { default: {} });
}
