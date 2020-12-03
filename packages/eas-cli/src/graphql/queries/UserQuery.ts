import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { CurrentUserQuery } from '../generated';

const UserQuery = {
  async currentUserAsync(): Promise<CurrentUserQuery['meActor']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<CurrentUserQuery>(
          gql`
            query CurrentUser {
              meActor {
                __typename
                id
                isExpoAdmin
                ... on User {
                  username
                }
                ... on Robot {
                  firstName
                }
                accounts {
                  id
                  name
                }
              }
            }
          `
        )
        .toPromise()
    );

    return data.meActor;
  },
};

export { UserQuery };
