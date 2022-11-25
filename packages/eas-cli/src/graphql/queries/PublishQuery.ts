import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AssetMetadataResult,
  GetAssetLimitPerUpdateGroupForAppQuery,
  GetAssetLimitPerUpdateGroupForAppQueryVariables,
  GetAssetMetadataQuery,
} from '../generated';

export const PublishQuery = {
  async getAssetMetadataAsync(
    graphqlClient: ExpoGraphqlClient,
    storageKeys: string[]
  ): Promise<AssetMetadataResult[]> {
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
  async getAssetLimitPerUpdateGroupAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string
  ): Promise<GetAssetLimitPerUpdateGroupForAppQuery['app']['byId']['assetLimitPerUpdateGroup']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<
          GetAssetLimitPerUpdateGroupForAppQuery,
          GetAssetLimitPerUpdateGroupForAppQueryVariables
        >(
          gql`
            query GetAssetLimitPerUpdateGroupForApp($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  assetLimitPerUpdateGroup
                }
              }
            }
          `,
          { appId },
          { additionalTypenames: [] } // required arg
        )
        .toPromise()
    );
    return data.app.byId.assetLimitPerUpdateGroup;
  },
};
