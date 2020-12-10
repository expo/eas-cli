import publishGraphQL from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';

const PublishQuery = {
  async getAssetMetadataAsync(
    assetHashes: string[]
  ): Promise<{ storageKey: string; status: string; __typename: string }[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<
          { asset: { metadata: { status: string; storageKey: string; __typename: string }[] } },
          { assetHashes: string[] }
        >(
          publishGraphQL` query {
          asset {
            metadata(storageKeys: ${JSON.stringify(assetHashes)}) {
              storageKey
              status
            }
          }
        }`,
          {
            assetHashes,
          },
          { requestPolicy: 'network-only' } // Since we reptitively query this to monitor the asset upload, we need to ensure it is not cached.
        )
        .toPromise()
    );
    return data.asset.metadata;
  },
};

export { PublishQuery };
