import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppStoreConnectApiKeyByAccountQuery,
  AppStoreConnectApiKeyFragment,
} from '../../../../../graphql/generated';
import { AppStoreConnectApiKeyFragmentNode } from '../../../../../graphql/types/credentials/AppStoreConnectApiKey';

export const AppStoreConnectApiKeyQuery = {
  async getAllForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string
  ): Promise<AppStoreConnectApiKeyFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppStoreConnectApiKeyByAccountQuery>(
          gql`
            query AppStoreConnectApiKeyByAccountQuery($accountName: String!) {
              account {
                byName(accountName: $accountName) {
                  id
                  appStoreConnectApiKeys {
                    id
                    ...AppStoreConnectApiKeyFragment
                  }
                }
              }
            }
            ${print(AppStoreConnectApiKeyFragmentNode)}
          `,
          {
            accountName,
          },
          {
            additionalTypenames: ['AppStoreConnectApiKey'],
          }
        )
        .toPromise()
    );
    return data.account.byName.appStoreConnectApiKeys;
  },
};
