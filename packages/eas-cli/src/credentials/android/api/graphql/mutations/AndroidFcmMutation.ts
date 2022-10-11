import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AndroidFcmFragment,
  AndroidFcmInput,
  CreateAndroidFcmMutation,
  DeleteAndroidFcmMutation,
} from '../../../../../graphql/generated';
import { AndroidFcmFragmentNode } from '../../../../../graphql/types/credentials/AndroidFcm';

export const AndroidFcmMutation = {
  async createAndroidFcmAsync(
    graphqlClient: ExpoGraphqlClient,
    androidFcmInput: AndroidFcmInput,
    accountId: string
  ): Promise<AndroidFcmFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAndroidFcmMutation>(
          gql`
            mutation CreateAndroidFcmMutation($androidFcmInput: AndroidFcmInput!, $accountId: ID!) {
              androidFcm {
                createAndroidFcm(androidFcmInput: $androidFcmInput, accountId: $accountId) {
                  id
                  ...AndroidFcmFragment
                }
              }
            }
            ${print(AndroidFcmFragmentNode)}
          `,
          {
            androidFcmInput,
            accountId,
          }
        )
        .toPromise()
    );
    assert(
      data.androidFcm.createAndroidFcm,
      'GraphQL: `createAndroidFcm` not defined in server response'
    );
    return data.androidFcm.createAndroidFcm;
  },
  async deleteAndroidFcmAsync(
    graphqlClient: ExpoGraphqlClient,
    androidFcmId: string
  ): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteAndroidFcmMutation>(
          gql`
            mutation DeleteAndroidFcmMutation($androidFcmId: ID!) {
              androidFcm {
                deleteAndroidFcm(id: $androidFcmId) {
                  id
                }
              }
            }
          `,
          {
            androidFcmId,
          },
          {
            additionalTypenames: ['AndroidFcm', 'AndroidAppCredentials'],
          }
        )
        .toPromise()
    );
  },
};
