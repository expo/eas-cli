import assert from 'assert';
import { print } from 'graphql';
import { gql } from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client.js';
import {
  AppStoreConnectApiKeyFragment,
  AppStoreConnectApiKeyInput,
  CreateAppStoreConnectApiKeyMutation,
  DeleteAppStoreConnectApiKeyMutation,
} from '../../../../../graphql/generated.js';
import { AppStoreConnectApiKeyFragmentNode } from '../../../../../graphql/types/credentials/AppStoreConnectApiKey.js';

export const AppStoreConnectApiKeyMutation = {
  async createAppStoreConnectApiKeyAsync(
    appStoreConnectApiKeyInput: AppStoreConnectApiKeyInput,
    accountId: string
  ): Promise<AppStoreConnectApiKeyFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAppStoreConnectApiKeyMutation>(
          gql`
            mutation CreateAppStoreConnectApiKeyMutation(
              $appStoreConnectApiKeyInput: AppStoreConnectApiKeyInput!
              $accountId: ID!
            ) {
              appStoreConnectApiKey {
                createAppStoreConnectApiKey(
                  appStoreConnectApiKeyInput: $appStoreConnectApiKeyInput
                  accountId: $accountId
                ) {
                  id
                  ...AppStoreConnectApiKeyFragment
                }
              }
            }
            ${print(AppStoreConnectApiKeyFragmentNode)}
          `,
          {
            appStoreConnectApiKeyInput,
            accountId,
          }
        )
        .toPromise()
    );
    assert(
      data.appStoreConnectApiKey.createAppStoreConnectApiKey,
      'GraphQL: `createAppStoreConnectApiKey` not defined in server response'
    );
    return data.appStoreConnectApiKey.createAppStoreConnectApiKey;
  },
  async deleteAppStoreConnectApiKeyAsync(appStoreConnectApiKeyId: string): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteAppStoreConnectApiKeyMutation>(
          gql`
            mutation DeleteAppStoreConnectApiKeyMutation($appStoreConnectApiKeyId: ID!) {
              appStoreConnectApiKey {
                deleteAppStoreConnectApiKey(id: $appStoreConnectApiKeyId) {
                  id
                }
              }
            }
          `,
          {
            appStoreConnectApiKeyId,
          },
          {
            additionalTypenames: ['AppStoreConnectApiKey', 'IosAppCredentials'],
          }
        )
        .toPromise()
    );
  },
};
