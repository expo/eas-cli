import gql from 'graphql-tag';

import { apiClient } from '../api';
import { graphqlClient } from '../graphql/client';
import { UserQuery } from '../graphql/queries/UserQuery';
import { Account } from './Account';
import { getAccessToken, getSessionSecret, setSessionAsync } from './sessionStorage';

// Re-export, but keep in separate file to avoid dependency cycle
export { getSessionSecret, getAccessToken };

export interface User {
  userId: string;
  username: string;
  accounts: Account[];
}

let currentUser: User | undefined;

export async function getUserAsync(): Promise<User | undefined> {
  if (!currentUser && getSessionSecret()) {
    const user = await UserQuery.currentUserAsync();
    currentUser = {
      userId: user.id,
      username: user.username,
      accounts: user.accounts,
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
  const body = await apiClient.post('auth/loginAsync', { json: { username, password } }).json();
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
