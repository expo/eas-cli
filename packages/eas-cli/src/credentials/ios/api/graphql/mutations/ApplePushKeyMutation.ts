import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  ApplePushKeyFragment,
  ApplePushKeyInput,
  CreateApplePushKeyMutation,
  DeleteApplePushKeyMutation,
} from '../../../../../graphql/generated';
import { ApplePushKeyFragmentNode } from '../../../../../graphql/types/credentials/ApplePushKey';

const ApplePushKeyMutation = {
  async createApplePushKey(
    applePushKeyInput: ApplePushKeyInput,
    accountId: string
  ): Promise<ApplePushKeyFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateApplePushKeyMutation>(
          gql`
            mutation CreateApplePushKeyMutation(
              $applePushKeyInput: ApplePushKeyInput!
              $accountId: ID!
            ) {
              applePushKey {
                createApplePushKey(applePushKeyInput: $applePushKeyInput, accountId: $accountId) {
                  id
                  ...ApplePushKeyFragment
                }
              }
            }
            ${print(ApplePushKeyFragmentNode)}
          `,
          {
            applePushKeyInput,
            accountId,
          }
        )
        .toPromise()
    );
    assert(
      data.applePushKey.createApplePushKey,
      'GraphQL: `createApplePushKey` not defined in server response'
    );
    return data.applePushKey.createApplePushKey;
  },
  async deleteApplePushKey(applePushKeyId: string): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteApplePushKeyMutation>(
          gql`
            mutation DeleteApplePushKeyMutation($applePushKeyId: ID!) {
              applePushKey {
                deleteApplePushKey(id: $applePushKeyId) {
                  id
                }
              }
            }
          `,
          {
            applePushKeyId,
          },
          {
            additionalTypenames: ['ApplePushKey', 'IosAppCredentials'],
          }
        )
        .toPromise()
    );
  },
};

export { ApplePushKeyMutation };
