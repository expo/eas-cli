import gql from 'graphql-tag';

import { ApiV2Client } from '../api';
import { createGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';

export async function fetchSessionSecretAndUserAsync({
  username,
  password,
  otp,
}: {
  username: string;
  password: string;
  otp?: string;
}): Promise<{ sessionSecret: string; id: string; username: string }> {
  // this is a logged-out endpoint
  const apiV2Client = new ApiV2Client({
    accessToken: null,
    sessionSecret: null,
  });
  const body = await apiV2Client.postAsync('auth/loginAsync', {
    body: { username, password, otp },
  });
  const { sessionSecret } = body.data;
  const graphqlClient = createGraphqlClient({ accessToken: null, sessionSecret: null });
  const result = await graphqlClient
    .query(
      gql`
        query UserQuery {
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
        additionalTypenames: [] /* UserQuery has immutable fields */,
      }
    )
    .toPromise();
  const { data } = result;
  return {
    sessionSecret,
    id: data.viewer.id,
    username: data.viewer.username,
  };
}
