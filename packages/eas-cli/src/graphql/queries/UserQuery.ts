import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { Account } from '../types/Account';
import { User } from '../types/User';

type ViewerData = Pick<User, 'id' | 'username'> & { accounts: Pick<Account, 'id' | 'name'>[] };

export class UserQuery {
  static async currentUserAsync(): Promise<ViewerData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ viewer: ViewerData }>(
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
