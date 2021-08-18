import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { PublishUpdateGroupInput, UpdatePublishMutation } from '../generated';

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
    publishUpdateGroupsInput: PublishUpdateGroupInput[]
  ): Promise<UpdatePublishMutation['updateBranch']['publishUpdateGroups']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdatePublishMutation>(
          gql`
            mutation UpdatePublishMutation($publishUpdateGroupsInput: [PublishUpdateGroupInput!]!) {
              updateBranch {
                publishUpdateGroups(publishUpdateGroupsInput: $publishUpdateGroupsInput) {
                  id
                  group
                  runtimeVersion
                  platform
                }
              }
            }
          `,
          { publishUpdateGroupsInput }
        )
        .toPromise()
    );
    return data.updateBranch.publishUpdateGroups;
  },
};

export { PublishMutation };
