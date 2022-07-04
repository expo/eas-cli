import assert from 'assert';
import { print } from 'graphql';
import { gql } from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client.js';
import {
  AppleAppIdentifierFragment,
  AppleAppIdentifierInput,
  CreateAppleAppIdentifierMutation,
} from '../../../../../graphql/generated.js';
import { AppleAppIdentifierFragmentNode } from '../../../../../graphql/types/credentials/AppleAppIdentifier.js';

export const AppleAppIdentifierMutation = {
  async createAppleAppIdentifierAsync(
    appleAppIdentifierInput: AppleAppIdentifierInput,
    accountId: string
  ): Promise<AppleAppIdentifierFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAppleAppIdentifierMutation>(
          gql`
            mutation CreateAppleAppIdentifierMutation(
              $appleAppIdentifierInput: AppleAppIdentifierInput!
              $accountId: ID!
            ) {
              appleAppIdentifier {
                createAppleAppIdentifier(
                  appleAppIdentifierInput: $appleAppIdentifierInput
                  accountId: $accountId
                ) {
                  id
                  ...AppleAppIdentifierFragment
                }
              }
            }
            ${print(AppleAppIdentifierFragmentNode)}
          `,
          {
            appleAppIdentifierInput,
            accountId,
          }
        )
        .toPromise()
    );
    assert(
      data.appleAppIdentifier.createAppleAppIdentifier,
      'GraphQL: `createAppleAppIdentifier` not defined in server response'
    );
    return data.appleAppIdentifier.createAppleAppIdentifier;
  },
};
