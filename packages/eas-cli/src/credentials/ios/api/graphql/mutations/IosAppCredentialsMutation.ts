import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  CommonIosAppCredentialsFragment,
  CreateIosAppCredentialsMutation,
  IosAppCredentialsInput,
  SetPushKeyMutation,
} from '../../../../../graphql/generated';
import { CommonIosAppCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppCredentials';

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
};
