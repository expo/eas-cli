import gql from 'graphql-tag';

import { apiClient, graphqlClient } from '../api';
import { getSession, setSessionAsync } from './sessionStorage';

export interface User {
  userId: string;
  username: string;
}

let currentUser: User | undefined;

export function getAccessToken(): string | null {
  return process.env.EXPO_TOKEN ?? null;
}

export function getSessionSecret(): string | null {
  return getSession()?.sessionSecret ?? null;
}

export async function getUserAsync(): Promise<User | undefined> {
  if (!currentUser && getSessionSecret()) {
    const result = await graphqlClient
      .query(
        gql`
          {
            viewer {
              id
              username
            }
          }
        `
      )
      .toPromise();
    const { data } = result;
    currentUser = {
      userId: data.viewer.id,
      username: data.viewer.username,
    };
  }
  return currentUser;
}

export async function loginAsync({
  username,
  password,
}: {
  username: string;
  password: string;
}): Promise<void> {
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
  await setSessionAsync({
    sessionSecret,
    userId: data.viewer.id,
    username: data.viewer.username,
    currentConnection: 'Username-Password-Authentication',
  });
}

export async function logoutAsync() {
  currentUser = undefined;
  await setSessionAsync(undefined);
}
