import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  CreateGoogleServiceAccountKeyMutation,
  GoogleServiceAccountKeyFragment,
  GoogleServiceAccountKeyInput,
} from '../../../../../graphql/generated';
import { GoogleServiceAccountKeyFragmentNode } from '../../../../../graphql/types/credentials/GoogleServiceAccountKey';

const GoogleServiceAccountKeyMutation = {
  async createGoogleServiceAccountKeyAsync(
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
};

export { GoogleServiceAccountKeyMutation };
