import gql from 'graphql-tag';

import { createGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';

export async function fetchUserAsync({
  sessionSecret,
}: {
  sessionSecret: string;
}): Promise<{ id: string; username: string }> {
  const graphqlClient = createGraphqlClient({ accessToken: null, sessionSecret });
  const result = await graphqlClient
    .query(
      gql`
        query UserQuery {
          meUserActor {
            id
            username
          }
        }
      `,
      {},
      {
        additionalTypenames: [] /* UserQuery has immutable fields */,
      }
    )
    .toPromise();

  const { data } = result;
  return {
    id: data.meUserActor.id,
    username: data.meUserActor.username,
  };
}
