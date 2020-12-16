import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';

const PublishQuery = {
  async getAssetMetadataAsync(
    storageKeys: string[]
  ): Promise<{ storageKey: string; status: string; __typename: string }[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<
          { asset: { metadata: { status: string; storageKey: string; __typename: string }[] } },
          { storageKeys: string[] }
        >(
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
