import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { PublishUpdateGroupInput, Update } from '../generated';

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
  ): Promise<Pick<Update, 'updateGroup'>> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          { updateRelease: { publishUpdateGroup: Pick<Update, 'updateGroup'>[] } },
          { publishUpdateGroupInput: PublishUpdateGroupInput }
        >(
          gql`
            mutation PublishMutation($publishUpdateGroupInput: PublishUpdateGroupInput) {
              updateRelease {
                publishUpdateGroup(publishUpdateGroupInput: $publishUpdateGroupInput) {
                  updateGroup
                }
              }
            }
          `,
          { publishUpdateGroupInput }
        )
        .toPromise()
    );
    return data.updateRelease.publishUpdateGroup[0];
  },
};

export { PublishMutation };
