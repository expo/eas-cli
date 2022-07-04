import { print } from 'graphql';
import { gql } from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client.js';
import {
  GoogleServiceAccountKeyByAccountQuery,
  GoogleServiceAccountKeyFragment,
} from '../../../../../graphql/generated.js';
import { GoogleServiceAccountKeyFragmentNode } from '../../../../../graphql/types/credentials/GoogleServiceAccountKey.js';

export const GoogleServiceAccountKeyQuery = {
  async getAllForAccountAsync(accountName: string): Promise<GoogleServiceAccountKeyFragment[]> {
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
