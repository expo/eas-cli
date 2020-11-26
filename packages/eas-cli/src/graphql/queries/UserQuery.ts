import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { Account, User } from '../generated';

type CurrentUserQueryResult = Pick<User, 'id' | 'username'> & {
  accounts: Pick<Account, 'id' | 'name'>[];
};

const UserQuery = {
  async currentUserAsync(): Promise<CurrentUserQueryResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ viewer: CurrentUserQueryResult }>(
          gql`
            {
              viewer {
                id
                username
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

    return data.viewer;
  },
};

export { UserQuery };
