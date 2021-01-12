import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleAppIdentifierByBundleIdQuery,
  AppleAppIdentifierFragment,
} from '../../../../../graphql/generated';
import { AppleAppIdentifierFragmentNode } from '../../../../../graphql/types/credentials/AppleAppIdentifier';

const AppleAppIdentifierQuery = {
  async byBundleIdentifierAsync(
    accountName: string,
    bundleIdentifier: string
  ): Promise<AppleAppIdentifierFragment | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleAppIdentifierByBundleIdQuery>(
          gql`
            query AppleAppIdentifierByBundleIdQuery(
              $accountName: String!
              $bundleIdentifier: String!
            ) {
              account {
                byName(accountName: $accountName) {
                  id
                  appleAppIdentifiers(bundleIdentifier: $bundleIdentifier) {
                    id
                    ...AppleAppIdentifierFragment
                  }
                }
              }
            }
            ${print(AppleAppIdentifierFragmentNode)}
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
