import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { Account } from '../types/Account';
import { User } from '../types/User';

type CurrentUserQueryResult = Pick<User, 'id' | 'username'> & {
  accounts: Pick<Account, 'id' | 'name'>[];
};

export class UserQuery {
  static async currentUserAsync(): Promise<CurrentUserQueryResult> {
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
  }
}
