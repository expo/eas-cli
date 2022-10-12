import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  GoogleServiceAccountKeyByAccountQuery,
  GoogleServiceAccountKeyFragment,
} from '../../../../../graphql/generated';
import { GoogleServiceAccountKeyFragmentNode } from '../../../../../graphql/types/credentials/GoogleServiceAccountKey';

export const GoogleServiceAccountKeyQuery = {
  async getAllForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string
  ): Promise<GoogleServiceAccountKeyFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GoogleServiceAccountKeyByAccountQuery>(
          gql`
            query GoogleServiceAccountKeyByAccountQuery($accountName: String!) {
              account {
                byName(accountName: $accountName) {
                  id
                  googleServiceAccountKeys {
                    id
                    ...GoogleServiceAccountKeyFragment
                  }
                }
              }
            }
            ${print(GoogleServiceAccountKeyFragmentNode)}
          `,
          {
            accountName,
          },
          {
            additionalTypenames: ['GoogleServiceAccountKey'],
          }
        )
        .toPromise()
    );
    return data.account.byName.googleServiceAccountKeys;
  },
};
