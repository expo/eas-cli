import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  AssetMetadataResult,
  GetAssetLimitForAppQuery,
  GetAssetLimitForAppQueryVariables,
  GetAssetMetadataQuery,
} from '../generated';

export const PublishQuery = {
  async getAssetMetadataAsync(storageKeys: string[]): Promise<AssetMetadataResult[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GetAssetMetadataQuery>(
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
          {
            requestPolicy: 'network-only',
            additionalTypenames: ['AssetMetadataResult'],
          } // Since we reptitively query this to monitor the asset upload, we need to ensure it is not cached.
        )
        .toPromise()
    );
    return data.asset.metadata;
  },
  async getAssetLimitAsync(
    appId: string
  ): Promise<GetAssetLimitForAppQuery['app']['byId']['assetLimitPerUpdateGroup']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GetAssetLimitForAppQuery, GetAssetLimitForAppQueryVariables>(
          gql`
            query GetAssetLimitForApp($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  assetLimitPerUpdateGroup
                }
              }
            }
          `,
          { appId },
          { additionalTypenames: [] }
        )
        .toPromise()
    );
    return data.app.byId.assetLimitPerUpdateGroup;
  },
};
