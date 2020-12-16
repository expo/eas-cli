import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { AssetMetadataResult } from '../generated';

const PublishQuery = {
  async getAssetMetadataAsync(storageKeys: string[]): Promise<AssetMetadataResult[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ asset: { metadata: AssetMetadataResult[] } }, { storageKeys: string[] }>(
          gql`
            query GetAssetMetadataQuery($storageKeys: [String!]!) {
              asset {
                metadata(storageKeys: $storageKeys) {
                  storageKey
                  status
                }
              }
            }
          `,
          {
            storageKeys,
          },
          { requestPolicy: 'network-only' } // Since we reptitively query this to monitor the asset upload, we need to ensure it is not cached.
        )
        .toPromise()
    );
    return data.asset.metadata;
  },
};

export { PublishQuery };
