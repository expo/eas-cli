import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AndroidKeystoreFragment,
  AndroidKeystoreInput,
  CreateAndroidKeystoreMutation,
  DeleteAndroidKeystoreMutation,
} from '../../../../../graphql/generated';
import { AndroidKeystoreFragmentNode } from '../../../../../graphql/types/credentials/AndroidKeystore';

export const AndroidKeystoreMutation = {
  async createAndroidKeystoreAsync(
    graphqlClient: ExpoGraphqlClient,
    androidKeystoreInput: AndroidKeystoreInput,
    accountId: string
  ): Promise<AndroidKeystoreFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAndroidKeystoreMutation>(
          gql`
            mutation CreateAndroidKeystoreMutation(
              $androidKeystoreInput: AndroidKeystoreInput!
              $accountId: ID!
            ) {
              androidKeystore {
                createAndroidKeystore(
                  androidKeystoreInput: $androidKeystoreInput
                  accountId: $accountId
                ) {
                  id
                  ...AndroidKeystoreFragment
                }
              }
            }
            ${print(AndroidKeystoreFragmentNode)}
          `,
          {
            androidKeystoreInput,
            accountId,
          }
        )
        .toPromise()
    );
    assert(
      data.androidKeystore.createAndroidKeystore,
      'GraphQL: `createAndroidKeystore` not defined in server response'
    );
    return data.androidKeystore.createAndroidKeystore;
  },
  async deleteAndroidKeystoreAsync(
    graphqlClient: ExpoGraphqlClient,
    androidKeystoreId: string
  ): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteAndroidKeystoreMutation>(
          gql`
            mutation DeleteAndroidKeystoreMutation($androidKeystoreId: ID!) {
              androidKeystore {
                deleteAndroidKeystore(id: $androidKeystoreId) {
                  id
                }
              }
            }
          `,
          {
            androidKeystoreId,
          },
          {
            additionalTypenames: ['AndroidKeystore', 'AndroidAppBuildCredentials'],
          }
        )
        .toPromise()
    );
  },
};
