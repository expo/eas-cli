import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { PublishUpdateGroupInput, Update, UpdatePublishMutation } from '../generated';

const PublishMutation = {
  async getUploadURLsAsync(contentTypes: string[]): Promise<{ specifications: string[] }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          { asset: { getSignedAssetUploadSpecifications: { specifications: string[] } } },
          { contentTypes: string[] }
        >(
          gql`
            mutation GetSignedUploadMutation($contentTypes: [String!]!) {
              asset {
                getSignedAssetUploadSpecifications(assetContentTypes: $contentTypes) {
                  specifications
                }
              }
            }
          `,
          {
            contentTypes,
          }
        )
        .toPromise()
    );
    return data.asset.getSignedAssetUploadSpecifications;
  },

  async publishUpdateGroupAsync(
    publishUpdateGroupInput: PublishUpdateGroupInput
  ): Promise<Pick<Update, 'id' | 'updateGroup'>> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdatePublishMutation>(
          gql`
            mutation UpdatePublishMutation($publishUpdateGroupInput: PublishUpdateGroupInput) {
              updateBranch {
                publishUpdateGroup(publishUpdateGroupInput: $publishUpdateGroupInput) {
                  id
                  updateGroup
                }
              }
            }
          `,
          { publishUpdateGroupInput }
        )
        .toPromise()
    );
    return data.updateBranch.publishUpdateGroup[0]!;
  },
};

export { PublishMutation };
