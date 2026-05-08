import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';

export type EmbeddedUpdateAssetUploadSpec = {
  storageKey: string;
  presignedUrl: string;
  fields: Record<string, string>;
};

type GetSignedEmbeddedUploadSpecMutationResult = {
  embeddedUpdateAsset: {
    getSignedEmbeddedUpdateAssetUploadSpecifications: EmbeddedUpdateAssetUploadSpec;
  };
};

export const EmbeddedUpdateAssetMutation = {
  async getSignedUploadSpecAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, contentType }: { appId: string; contentType: string }
  ): Promise<EmbeddedUpdateAssetUploadSpec> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<GetSignedEmbeddedUploadSpecMutationResult>(
          gql`
            mutation GetSignedEmbeddedUpdateAssetUploadSpec(
              $appId: ID!
              $contentType: String!
            ) {
              embeddedUpdateAsset {
                getSignedEmbeddedUpdateAssetUploadSpecifications(
                  appId: $appId
                  contentType: $contentType
                ) {
                  storageKey
                  presignedUrl
                  fields
                }
              }
            }
          `,
          { appId, contentType }
        )
        .toPromise()
    );
    return data.embeddedUpdateAsset.getSignedEmbeddedUpdateAssetUploadSpecifications;
  },
};
