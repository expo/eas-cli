import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleAppIdentifierByBundleIdQuery,
  AppleAppIdentifierFragment,
} from '../../../../../graphql/generated';
import { AppleAppIdentifierFragmentNode } from '../../../../../graphql/types/credentials/AppleAppIdentifier';

export const AppleAppIdentifierQuery = {
  async byBundleIdentifierAsync(
    graphqlClient: ExpoGraphqlClient,
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
