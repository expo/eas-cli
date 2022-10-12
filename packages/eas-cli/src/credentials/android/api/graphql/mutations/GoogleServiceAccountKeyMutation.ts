import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  CreateGoogleServiceAccountKeyMutation,
  DeleteGoogleServiceAccountKeyMutation,
  GoogleServiceAccountKeyFragment,
  GoogleServiceAccountKeyInput,
} from '../../../../../graphql/generated';
import { GoogleServiceAccountKeyFragmentNode } from '../../../../../graphql/types/credentials/GoogleServiceAccountKey';

export const GoogleServiceAccountKeyMutation = {
  async createGoogleServiceAccountKeyAsync(
    graphqlClient: ExpoGraphqlClient,
    googleServiceAccountKeyInput: GoogleServiceAccountKeyInput,
    accountId: string
  ): Promise<GoogleServiceAccountKeyFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateGoogleServiceAccountKeyMutation>(
          gql`
            mutation CreateGoogleServiceAccountKeyMutation(
              $googleServiceAccountKeyInput: GoogleServiceAccountKeyInput!
              $accountId: ID!
            ) {
              googleServiceAccountKey {
                createGoogleServiceAccountKey(
                  googleServiceAccountKeyInput: $googleServiceAccountKeyInput
                  accountId: $accountId
                ) {
                  id
                  ...GoogleServiceAccountKeyFragment
                }
              }
            }
            ${print(GoogleServiceAccountKeyFragmentNode)}
          `,
          {
            googleServiceAccountKeyInput,
            accountId,
          }
        )
        .toPromise()
    );
    assert(
      data.googleServiceAccountKey.createGoogleServiceAccountKey,
      'GraphQL: `createAndroidFcm` not defined in server response'
    );
    return data.googleServiceAccountKey.createGoogleServiceAccountKey;
  },
  async deleteGoogleServiceAccountKeyAsync(
    graphqlClient: ExpoGraphqlClient,
    googleServiceAccountKeyId: string
  ): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteGoogleServiceAccountKeyMutation>(
          gql`
            mutation DeleteGoogleServiceAccountKeyMutation($googleServiceAccountKeyId: ID!) {
              googleServiceAccountKey {
                deleteGoogleServiceAccountKey(id: $googleServiceAccountKeyId) {
                  id
                }
              }
            }
          `,
          {
            googleServiceAccountKeyId,
          },
          {
            additionalTypenames: ['GoogleServiceAccountKey', 'AndroidAppCredentials'],
          }
        )
        .toPromise()
    );
  },
};
