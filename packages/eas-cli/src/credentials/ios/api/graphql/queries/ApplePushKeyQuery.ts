import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { ApplePushKeyByAccountQuery, ApplePushKeyFragment } from '../../../../../graphql/generated';
import { ApplePushKeyFragmentNode } from '../../../../../graphql/types/credentials/ApplePushKey';

const ApplePushKeyQuery = {
  async getAllForAccountAsync(accountName: string): Promise<ApplePushKeyFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<ApplePushKeyByAccountQuery>(
          gql`
            query ApplePushKeyByAccountQuery($accountName: String!) {
              account {
                byName(accountName: $accountName) {
                  id
                  applePushKeys {
                    id
                    ...ApplePushKeyFragment
                  }
                }
              }
            }
            ${print(ApplePushKeyFragmentNode)}
          `,
          {
            accountName,
          }
        )
        .toPromise()
    );
    return data.account.byName.applePushKeys;
  },
};

export { ApplePushKeyQuery };
