import assert from 'assert';
import { print } from 'graphql';
import { gql } from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client.js';
import {
  CommonIosAppCredentialsFragment,
  CreateIosAppCredentialsMutation,
  IosAppCredentialsInput,
  SetAppStoreConnectApiKeyForSubmissionsMutation,
  SetPushKeyMutation,
} from '../../../../../graphql/generated.js';
import { CommonIosAppCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppCredentials.js';

export const IosAppCredentialsMutation = {
  async createIosAppCredentialsAsync(
    iosAppCredentialsInput: IosAppCredentialsInput,
    appId: string,
    appleAppIdentifierId: string
  ): Promise<CommonIosAppCredentialsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateIosAppCredentialsMutation>(
          gql`
            mutation CreateIosAppCredentialsMutation(
              $iosAppCredentialsInput: IosAppCredentialsInput!
              $appId: ID!
              $appleAppIdentifierId: ID!
            ) {
              iosAppCredentials {
                createIosAppCredentials(
                  iosAppCredentialsInput: $iosAppCredentialsInput
                  appId: $appId
                  appleAppIdentifierId: $appleAppIdentifierId
                ) {
                  id
                  ...CommonIosAppCredentialsFragment
                }
              }
            }
            ${print(CommonIosAppCredentialsFragmentNode)}
          `,
          {
            iosAppCredentialsInput,
            appId,
            appleAppIdentifierId,
          }
        )
        .toPromise()
    );
    assert(
      data.iosAppCredentials.createIosAppCredentials,
      'GraphQL: `createIosAppCredentials` not defined in server response'
    );
    return data.iosAppCredentials.createIosAppCredentials;
  },
  async setPushKeyAsync(
    iosAppCredentialsId: string,
    pushKeyId: string
  ): Promise<CommonIosAppCredentialsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<SetPushKeyMutation>(
          gql`
            mutation SetPushKeyMutation($iosAppCredentialsId: ID!, $pushKeyId: ID!) {
              iosAppCredentials {
                setPushKey(id: $iosAppCredentialsId, pushKeyId: $pushKeyId) {
                  id
                  ...CommonIosAppCredentialsFragment
                }
              }
            }
            ${print(CommonIosAppCredentialsFragmentNode)}
          `,
          {
            iosAppCredentialsId,
            pushKeyId,
          }
        )
        .toPromise()
    );
    return data.iosAppCredentials.setPushKey;
  },
  async setAppStoreConnectApiKeyForSubmissionsAsync(
    iosAppCredentialsId: string,
    ascApiKeyId: string
  ): Promise<CommonIosAppCredentialsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<SetAppStoreConnectApiKeyForSubmissionsMutation>(
          gql`
            mutation SetAppStoreConnectApiKeyForSubmissionsMutation(
              $iosAppCredentialsId: ID!
              $ascApiKeyId: ID!
            ) {
              iosAppCredentials {
                setAppStoreConnectApiKeyForSubmissions(
                  id: $iosAppCredentialsId
                  ascApiKeyId: $ascApiKeyId
                ) {
                  id
                  ...CommonIosAppCredentialsFragment
                }
              }
            }
            ${print(CommonIosAppCredentialsFragmentNode)}
          `,
          {
            iosAppCredentialsId,
            ascApiKeyId,
          }
        )
        .toPromise()
    );
    return data.iosAppCredentials.setAppStoreConnectApiKeyForSubmissions;
  },
};
