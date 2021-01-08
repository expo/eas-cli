import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleAppIdentifier } from '../../../../../graphql/generated';
import { AppleAppIdentifierFragmentDoc } from '../../../../../graphql/types/credentials/AppleAppIdentifier';

const AppleAppIdentifierQuery = {
  async byBundleIdentifierAsync(
    accountName: string,
    bundleIdentifier: string
  ): Promise<AppleAppIdentifier | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ account: { byName: { appleAppIdentifiers: AppleAppIdentifier[] } } }>(
          gql`
            query($accountName: String!, $bundleIdentifier: String!) {
              account {
                byName(accountName: $accountName) {
                  appleAppIdentifiers(bundleIdentifier: $bundleIdentifier) {
                    ...AppleAppIdentifierFragment
                  }
                }
              }
            }
            ${print(AppleAppIdentifierFragmentDoc)}
          `,
          {
            accountName,
            bundleIdentifier,
          },
          {
            additionalTypenames: ['AppleAppIdentifier'],
          }
        )
        .toPromise()
    );
    return data.account.byName.appleAppIdentifiers[0];
  },
};

export { AppleAppIdentifierQuery };
