import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppStoreConnectApiKeyFragment,
  AppStoreConnectApiKeyInput,
  AppStoreConnectApiKeyUpdateInput,
  CreateAppStoreConnectApiKeyMutation,
  DeleteAppStoreConnectApiKeyMutation,
  UpdateAppStoreConnectApiKeyMutation,
} from '../../../../../graphql/generated';
import { AppStoreConnectApiKeyFragmentNode } from '../../../../../graphql/types/credentials/AppStoreConnectApiKey';

export const AppStoreConnectApiKeyMutation = {
  async createAppStoreConnectApiKeyAsync(
    graphqlClient: ExpoGraphqlClient,
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
  async updateAppStoreConnectApiKeyAsync(
    graphqlClient: ExpoGraphqlClient,
    appStoreConnectApiKeyUpdateInput: AppStoreConnectApiKeyUpdateInput,
    appStoreConnectApiKeyId: string
  ): Promise<AppStoreConnectApiKeyFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdateAppStoreConnectApiKeyMutation>(
          gql`
            mutation UpdateAppStoreConnectApiKeyMutation(
              $appStoreConnectApiKeyUpdateInput: AppStoreConnectApiKeyUpdateInput!
              $id: ID!
            ) {
              appStoreConnectApiKey {
                updateAppStoreConnectApiKey(
                  appStoreConnectApiKeyUpdateInput: $appStoreConnectApiKeyUpdateInput
                  id: $id
                ) {
                  id
                  ...AppStoreConnectApiKeyFragment
                }
              }
            }
            ${print(AppStoreConnectApiKeyFragmentNode)}
          `,
          {
            appStoreConnectApiKeyUpdateInput,
            appStoreConnectApiKeyId,
          }
        )
        .toPromise()
    );
    assert(
      data.appStoreConnectApiKey.updateAppStoreConnectApiKey,
      'GraphQL: `updateAppStoreConnectApiKey` not defined in server response'
    );
    return data.appStoreConnectApiKey.updateAppStoreConnectApiKey;
  },
  async deleteAppStoreConnectApiKeyAsync(
    graphqlClient: ExpoGraphqlClient,
    appStoreConnectApiKeyId: string
  ): Promise<void> {
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
