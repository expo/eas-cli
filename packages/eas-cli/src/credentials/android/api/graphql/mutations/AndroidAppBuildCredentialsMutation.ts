import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AndroidAppBuildCredentialsFragment,
  AndroidAppBuildCredentialsInput,
  CreateAndroidAppBuildCredentialsMutation,
  SetKeystoreMutation,
} from '../../../../../graphql/generated';
import { AndroidAppBuildCredentialsFragmentNode } from '../../../../../graphql/types/credentials/AndroidAppBuildCredentials';

export type AndroidAppBuildCredentialsMetadataInput = Omit<
  AndroidAppBuildCredentialsInput,
  'keystoreId'
>;
export const AndroidAppBuildCredentialsMutation = {
  async createAndroidAppBuildCredentialsAsync(
    graphqlClient: ExpoGraphqlClient,
    androidAppBuildCredentialsInput: AndroidAppBuildCredentialsInput,
    androidAppCredentialsId: string
  ): Promise<AndroidAppBuildCredentialsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAndroidAppBuildCredentialsMutation>(
          gql`
            mutation CreateAndroidAppBuildCredentialsMutation(
              $androidAppBuildCredentialsInput: AndroidAppBuildCredentialsInput!
              $androidAppCredentialsId: ID!
            ) {
              androidAppBuildCredentials {
                createAndroidAppBuildCredentials(
                  androidAppBuildCredentialsInput: $androidAppBuildCredentialsInput
                  androidAppCredentialsId: $androidAppCredentialsId
                ) {
                  id
                  ...AndroidAppBuildCredentialsFragment
                }
              }
            }
            ${print(AndroidAppBuildCredentialsFragmentNode)}
          `,
          {
            androidAppBuildCredentialsInput,
            androidAppCredentialsId,
          }
        )
        .toPromise()
    );
    assert(
      data.androidAppBuildCredentials.createAndroidAppBuildCredentials,
      'GraphQL: `createAndroidAppBuildCredentials` not defined in server response'
    );
    return data.androidAppBuildCredentials.createAndroidAppBuildCredentials;
  },
  async setKeystoreAsync(
    graphqlClient: ExpoGraphqlClient,
    androidAppBuildCredentialsId: string,
    keystoreId: string
  ): Promise<AndroidAppBuildCredentialsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<SetKeystoreMutation>(
          gql`
            mutation SetKeystoreMutation($androidAppBuildCredentialsId: ID!, $keystoreId: ID!) {
              androidAppBuildCredentials {
                setKeystore(id: $androidAppBuildCredentialsId, keystoreId: $keystoreId) {
                  id
                  ...AndroidAppBuildCredentialsFragment
                }
              }
            }
            ${print(AndroidAppBuildCredentialsFragmentNode)}
          `,
          {
            androidAppBuildCredentialsId,
            keystoreId,
          }
        )
        .toPromise()
    );
    assert(
      data.androidAppBuildCredentials.setKeystore,
      'GraphQL: `setKeystore` not defined in server response'
    );
    return data.androidAppBuildCredentials.setKeystore;
  },
};
