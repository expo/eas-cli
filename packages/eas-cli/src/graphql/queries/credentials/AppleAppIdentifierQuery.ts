import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../client';
import {
  AppleAppIdentifier,
  AppleAppIdentifierFragment,
} from '../../types/credentials/AppleAppIdentifier';

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
                    ...${AppleAppIdentifierFragment.name}
                  }
                }
              }
            }
            ${AppleAppIdentifierFragment.definition}
          `,
          {
            accountName,
            bundleIdentifier,
          }
        )
        .toPromise()
    );
    return data.account.byName.appleAppIdentifiers[0];
  },
};

export { AppleAppIdentifierQuery };
