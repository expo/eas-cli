import gql from 'graphql-tag';

import { apiClient } from '../api';
import { graphqlClient } from '../graphql/client';
import { UserQuery } from '../graphql/queries/UserQuery';
import { Account } from './Account';
import { getAccessToken, getSessionSecret, setSessionAsync } from './sessionStorage';

// Re-export, but keep in separate file to avoid dependency cycle
export { getSessionSecret, getAccessToken };

export interface User {
  kind: 'user';
  userId: string;
  username: string;
  accounts: Account[];
}

export interface RobotUser {
  kind: 'robot';
  userId: string;
  firstName?: string;
  accounts: Account[];
  // Generated username to display as "authenticated user", it's either `robot` or `{firstName} (robot)`
  username: string;
}

let currentUser: User | RobotUser | undefined;

export async function getUserAsync(): Promise<User | RobotUser | undefined> {
  if (!currentUser && (getAccessToken() || getSessionSecret())) {
    const user = await UserQuery.currentUserAsync();
    if (user?.__typename === 'User') {
      currentUser = {
        kind: 'user',
        userId: user.id,
        username: user.username,
        accounts: user.accounts,
      };
    } else if (user?.__typename === 'Robot') {
      currentUser = {
        kind: 'robot',
        userId: user.id,
        firstName: user.firstName ?? undefined,
        username: user.firstName ? `${user.firstName} (robot)` : 'robot',
        accounts: user.accounts,
      }
    }
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
