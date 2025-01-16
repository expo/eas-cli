import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  FingerprintFilterInput,
  FingerprintFragment,
  FingerprintsByAppIdQuery,
} from '../generated';
import { FingerprintFragmentNode } from '../types/Fingerprint';

export const FingerprintQuery = {
  async byHashAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      hash,
    }: {
      appId: string;
      hash: string;
    }
  ): Promise<FingerprintFragment | null> {
    const fingerprintConnection = await FingerprintQuery.getFingerprintsAsync(graphqlClient, {
      appId,
      fingerprintFilter: { hashes: [hash] },
      first: 1,
    });
    const fingerprints = fingerprintConnection.edges.map(edge => edge.node);
    return fingerprints[0] ?? null;
  },
  async getFingerprintsAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      first,
      after,
      last,
      before,
      fingerprintFilter,
    }: {
      appId: string;
      first?: number;
      after?: string;
      last?: number;
      before?: string;
      fingerprintFilter?: FingerprintFilterInput;
    }
  ): Promise<FingerprintsByAppIdQuery['app']['byId']['fingerprintsPaginated']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<FingerprintsByAppIdQuery>(
          gql`
            query FingerprintsByAppId(
              $appId: String!
              $after: String
              $first: Int
              $before: String
              $last: Int
              $fingerprintFilter: FingerprintFilterInput
            ) {
              app {
                byId(appId: $appId) {
                  id
                  fingerprintsPaginated(
                    after: $after
                    first: $first
                    before: $before
                    last: $last
                    filter: $fingerprintFilter
                  ) {
                    edges {
                      node {
                        id
                        ...FingerprintFragment
                      }
                    }
                    pageInfo {
                      hasNextPage
                      hasPreviousPage
                      startCursor
                      endCursor
                    }
                  }
                }
              }
            }
            ${print(FingerprintFragmentNode)}
          `,
          { appId, after, first, before, last, fingerprintFilter },
          { additionalTypenames: ['Fingerprint'] }
        )
        .toPromise()
    );

    return data.app?.byId.fingerprintsPaginated;
  },
};
