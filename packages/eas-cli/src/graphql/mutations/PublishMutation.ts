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
  ): Promise<Pick<Update, 'group'>> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdatePublishMutation>(
          gql`
            mutation UpdatePublishMutation($publishUpdateGroupInput: PublishUpdateGroupInput) {
              updateBranch {
                publishUpdateGroup(publishUpdateGroupInput: $publishUpdateGroupInput) {
                  id
                  group
                }
              }
            }
          `,
          { publishUpdateGroupInput }
        )
        .toPromise()
    );
    const { group } = data.updateBranch.publishUpdateGroup[0]!;
    return { group };
  },
};

export { PublishMutation };
