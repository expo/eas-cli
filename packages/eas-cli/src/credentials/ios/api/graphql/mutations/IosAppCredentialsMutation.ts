import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  CreateIosAppCredentialsMutation,
  IosAppCredentialsFragment,
  IosAppCredentialsInput,
} from '../../../../../graphql/generated';
import { IosAppCredentialsFragmentNode } from '../../../../../graphql/types/credentials/IosAppCredentials';

const IosAppCredentialsMutation = {
  async createIosAppCredentialsAsync(
    iosAppCredentialsInput: IosAppCredentialsInput,
    appId: string,
    appleAppIdentifierId: string
  ): Promise<IosAppCredentialsFragment> {
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
                  ...IosAppCredentialsFragment
                }
              }
            }
            ${print(IosAppCredentialsFragmentNode)}
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
};

export { IosAppCredentialsMutation };
