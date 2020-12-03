import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { Account, Robot, User } from '../generated';

type CurrentUserQueryResult = { accounts: Pick<Account, 'id' | 'name'>[] } & (
  | Pick<User, '__typename' | 'id' | 'username'>
  | Pick<Robot, '__typename' | 'id' | 'firstName'>
);

const UserQuery = {
  async currentUserAsync(): Promise<CurrentUserQueryResult | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ meActor: CurrentUserQueryResult | null }>(
          gql`
            {
              meActor {
                __typename
                id
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
