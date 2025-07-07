import gql from 'graphql-tag';

import { createGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../graphql/client';
import { MeUserActorQuery, MeUserActorQueryVariables } from '../graphql/generated';

export async function fetchUserAsync({
  sessionSecret,
}: {
  sessionSecret: string;
}): Promise<{ id: string; username: string }> {
  const graphqlClient = createGraphqlClient({ accessToken: null, sessionSecret });
  const result = await withErrorHandlingAsync(
    graphqlClient
      .query<MeUserActorQuery, MeUserActorQueryVariables>(
        gql`
          query MeUserActorQuery {
            meUserActor {
              id
              username
            }
          }
        `,
        {},
        { additionalTypenames: ['UserActor'] }
      )
      .toPromise()
  );

  const meUserActor = result.meUserActor;
  if (!meUserActor) {
    throw new Error('Failed to fetch user data after login.');
  }

  return {
    id: meUserActor.id,
    username: meUserActor.username,
  };
}
