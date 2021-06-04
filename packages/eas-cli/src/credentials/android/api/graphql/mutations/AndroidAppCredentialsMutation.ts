import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  CommonAndroidAppCredentialsFragment,
  CreateAndroidAppCredentialsMutation,
  SetFcmMutation,
} from '../../../../../graphql/generated';
import { CommonAndroidAppCredentialsFragmentNode } from '../../../../../graphql/types/credentials/AndroidAppCredentials';

const AndroidAppCredentialsMutation = {
  async createAndroidAppCredentialsAsync(
    androidAppCredentialsInput: {
      fcmId?: string;
    },
    appId: string,
    applicationIdentifier: string
  ): Promise<CommonAndroidAppCredentialsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAndroidAppCredentialsMutation>(
          gql`
            mutation CreateAndroidAppCredentialsMutation(
              $androidAppCredentialsInput: AndroidAppCredentialsInput!
              $appId: ID!
              $applicationIdentifier: String!
            ) {
              androidAppCredentials {
                createAndroidAppCredentials(
                  androidAppCredentialsInput: $androidAppCredentialsInput
                  appId: $appId
                  applicationIdentifier: $applicationIdentifier
                ) {
                  id
                  ...CommonAndroidAppCredentialsFragment
                }
              }
            }
            ${print(CommonAndroidAppCredentialsFragmentNode)}
          `,
          {
            androidAppCredentialsInput,
            appId,
            applicationIdentifier,
          }
        )
        .toPromise()
    );
    assert(
      data.androidAppCredentials.createAndroidAppCredentials,
      'GraphQL: `createAndroidAppCredentials` not defined in server response'
    );
    return data.androidAppCredentials.createAndroidAppCredentials;
  },
  async setFcmKeyAsync(
    androidAppCredentialsId: string,
    fcmId: string
  ): Promise<CommonAndroidAppCredentialsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<SetFcmMutation>(
          gql`
            mutation SetFcmMutation($androidAppCredentialsId: ID!, $fcmId: ID!) {
              androidAppCredentials {
                setFcm(id: $androidAppCredentialsId, fcmId: $fcmId) {
                  id
                  ...CommonAndroidAppCredentialsFragment
                }
              }
            }
            ${print(CommonAndroidAppCredentialsFragmentNode)}
          `,
          {
            androidAppCredentialsId,
            fcmId,
          }
        )
        .toPromise()
    );
    assert(data.androidAppCredentials.setFcm, 'GraphQL: `setFcm` not defined in server response');
    return data.androidAppCredentials.setFcm;
  },
};

export { AndroidAppCredentialsMutation };
