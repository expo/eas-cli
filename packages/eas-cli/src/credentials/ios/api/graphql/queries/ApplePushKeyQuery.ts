import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import { ApplePushKeyByAccountQuery, ApplePushKeyFragment } from '../../../../../graphql/generated';
import { ApplePushKeyFragmentNode } from '../../../../../graphql/types/credentials/ApplePushKey';

export const ApplePushKeyQuery = {
  async getAllForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string
  ): Promise<ApplePushKeyFragment[]> {
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
          },
          {
            additionalTypenames: ['ApplePushKey'],
          }
        )
        .toPromise()
    );
    return data.account.byName.applePushKeys;
  },
};
