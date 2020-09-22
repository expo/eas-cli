import gql from 'graphql-tag';

import { apiClient, graphqlClient } from '../api';
import { getSessionSecret, invalidateSessionAsync, updateSessionSecretAsync } from './session';

export interface User {
  userId: string;
  username: string;
}

let currentUser: User | undefined;

export function isLoggedIn(): boolean {
  return !!getSessionSecret();
}

export async function getUserAsync(): Promise<User | undefined> {
  if (!currentUser && isLoggedIn()) {
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

export async function loginApiAsync({
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
  await updateSessionSecretAsync(sessionSecret, data.viewer.id, data.viewer.username);
}

export async function logoutAsync() {
  await invalidateSessionAsync();
}
