import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  GetSignedEmbeddedUpdateAssetUploadSpecMutation,
  GetSignedEmbeddedUpdateAssetUploadSpecMutationVariables,
} from '../generated';
import { withErrorHandlingAsync } from '../client';

export type EmbeddedUpdateAssetUploadSpec = {
  storageKey: string;
  presignedUrl: string;
  fields: Record<string, string>;
};

export const EmbeddedUpdateAssetMutation = {
  async getSignedUploadSpecAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      embeddedUpdateId,
      contentType,
    }: { appId: string; embeddedUpdateId: string; contentType: string }
  ): Promise<EmbeddedUpdateAssetUploadSpec> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          GetSignedEmbeddedUpdateAssetUploadSpecMutation,
          GetSignedEmbeddedUpdateAssetUploadSpecMutationVariables
        >(
          gql`
            mutation GetSignedEmbeddedUpdateAssetUploadSpec(
              $appId: ID!
              $embeddedUpdateId: ID!
              $contentType: String!
            ) {
              embeddedUpdateAsset {
                getSignedEmbeddedUpdateAssetUploadSpecifications(
                  appId: $appId
                  embeddedUpdateId: $embeddedUpdateId
                  contentType: $contentType
                ) {
                  storageKey
                  presignedUrl
                  fields
                }
              }
            }
          `,
          { appId, embeddedUpdateId, contentType }
        )
        .toPromise()
    );
    return data.embeddedUpdateAsset.getSignedEmbeddedUpdateAssetUploadSpecifications;
  },
};
