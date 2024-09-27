import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  CommonAndroidAppCredentialsFragment,
  CreateAndroidAppCredentialsMutation,
  SetFcmMutation,
  SetGoogleServiceAccountKeyForFcmV1Mutation,
  SetGoogleServiceAccountKeyForSubmissionsMutation,
} from '../../../../../graphql/generated';
import { CommonAndroidAppCredentialsFragmentNode } from '../../../../../graphql/types/credentials/AndroidAppCredentials';

export const AndroidAppCredentialsMutation = {
  async createAndroidAppCredentialsAsync(
    graphqlClient: ExpoGraphqlClient,
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
    graphqlClient: ExpoGraphqlClient,
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
  async setGoogleServiceAccountKeyForSubmissionsAsync(
    graphqlClient: ExpoGraphqlClient,
    androidAppCredentialsId: string,
    googleServiceAccountKeyId: string
  ): Promise<CommonAndroidAppCredentialsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<SetGoogleServiceAccountKeyForSubmissionsMutation>(
          gql`
            mutation SetGoogleServiceAccountKeyForSubmissionsMutation(
              $androidAppCredentialsId: ID!
              $googleServiceAccountKeyId: ID!
            ) {
              androidAppCredentials {
                setGoogleServiceAccountKeyForSubmissions(
                  id: $androidAppCredentialsId
                  googleServiceAccountKeyId: $googleServiceAccountKeyId
                ) {
                  id
                  ...CommonAndroidAppCredentialsFragment
                }
              }
            }
            ${print(CommonAndroidAppCredentialsFragmentNode)}
          `,
          {
            androidAppCredentialsId,
            googleServiceAccountKeyId,
          }
        )
        .toPromise()
    );
    assert(
      data.androidAppCredentials.setGoogleServiceAccountKeyForSubmissions,
      'GraphQL: `setGoogleServiceAccountKeyForSubmissions` not defined in server response'
    );
    return data.androidAppCredentials.setGoogleServiceAccountKeyForSubmissions;
  },
  async setGoogleServiceAccountKeyForFcmV1Async(
    graphqlClient: ExpoGraphqlClient,
    androidAppCredentialsId: string,
    googleServiceAccountKeyId: string
  ): Promise<CommonAndroidAppCredentialsFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<SetGoogleServiceAccountKeyForFcmV1Mutation>(
          gql`
            mutation SetGoogleServiceAccountKeyForFcmV1Mutation(
              $androidAppCredentialsId: ID!
              $googleServiceAccountKeyId: ID!
            ) {
              androidAppCredentials {
                setGoogleServiceAccountKeyForFcmV1(
                  id: $androidAppCredentialsId
                  googleServiceAccountKeyId: $googleServiceAccountKeyId
                ) {
                  id
                  ...CommonAndroidAppCredentialsFragment
                }
              }
            }
            ${print(CommonAndroidAppCredentialsFragmentNode)}
          `,
          {
            androidAppCredentialsId,
            googleServiceAccountKeyId,
          }
        )
        .toPromise()
    );
    assert(
      data.androidAppCredentials.setGoogleServiceAccountKeyForFcmV1,
      'GraphQL: `setGoogleServiceAccountKeyForFcmV1` not defined in server response'
    );
    return data.androidAppCredentials.setGoogleServiceAccountKeyForFcmV1;
  },
};
