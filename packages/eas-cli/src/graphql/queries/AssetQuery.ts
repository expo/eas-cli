import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AssetSignedUrlResult,
  GetAssetSignedUrlsQuery,
  GetAssetSignedUrlsQueryVariables,
} from '../generated';

export const AssetQuery = {
  async getSignedUrlsAsync(
    graphqlClient: ExpoGraphqlClient,
    updateId: string,
    storageKeys: string[]
  ): Promise<AssetSignedUrlResult[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GetAssetSignedUrlsQuery, GetAssetSignedUrlsQueryVariables>(
          gql`
            query GetAssetSignedUrls($updateId: ID!, $storageKeys: [String!]!) {
              asset {
                signedUrls(updateId: $updateId, storageKeys: $storageKeys) {
                  storageKey
                  url
                  headers
                }
              }
            }
          `,
          {
            updateId,
            storageKeys,
          },
          { additionalTypenames: [] }
        )
        .toPromise()
    );
    return data.asset.signedUrls;
  },
};
