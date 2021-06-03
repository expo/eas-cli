import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AndroidKeystoreFragment,
  AndroidKeystoreInput,
  AndroidKeystoreType,
  CreateAndroidKeystoreMutation,
} from '../../../../../graphql/generated';
import { AndroidKeystoreFragmentNode } from '../../../../../graphql/types/credentials/AndroidKeystore';

const AndroidKeystoreMutation = {
  async createAndroidKeystore(
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
};

export { AndroidKeystoreMutation };
