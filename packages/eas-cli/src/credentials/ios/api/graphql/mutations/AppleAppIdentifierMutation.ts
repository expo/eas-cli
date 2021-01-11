import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleAppIdentifier } from '../../../../../graphql/generated';
import { AppleAppIdentifierFragmentNode } from '../../../../../graphql/types/credentials/AppleAppIdentifier';

const AppleAppIdentifierMutation = {
  async createAppleAppIdentifierAsync(
    appleAppIdentifierInput: {
      bundleIdentifier: string;
      appleTeamId?: string;
    },
    accountId: string
  ): Promise<AppleAppIdentifier> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{ appleAppIdentifier: { createAppleAppIdentifier: AppleAppIdentifier } }>(
          gql`
            mutation AppleAppIdentifierMutation(
              $appleAppIdentifierInput: AppleAppIdentifierInput!
              $accountId: ID!
            ) {
              appleAppIdentifier {
                createAppleAppIdentifier(
                  appleAppIdentifierInput: $appleAppIdentifierInput
                  accountId: $accountId
                ) {
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
    return data.appleAppIdentifier.createAppleAppIdentifier;
  },
};

export { AppleAppIdentifierMutation };
