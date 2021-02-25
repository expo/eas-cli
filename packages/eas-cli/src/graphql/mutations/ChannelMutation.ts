import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  CreateUpdateChannelForAppMutation,
  CreateUpdateChannelForAppMutationVariables,
  UpdateChannelBranchMappingMutation,
  UpdateChannelBranchMappingMutationVariables,
} from '../generated';

const ChannelMutation = {
  async createForAppAsync(variables: CreateUpdateChannelForAppMutationVariables) {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateUpdateChannelForAppMutation>(
          gql`
            mutation CreateUpdateChannelForApp(
              $appId: ID!
              $name: String!
              $branchMapping: String!
            ) {
              updateChannel {
                createUpdateChannelForApp(
                  appId: $appId
                  name: $name
                  branchMapping: $branchMapping
                ) {
                  id
                  name
                  branchMapping
                }
              }
            }
          `,
          variables
        )
        .toPromise()
    );
    return data.updateChannel.createUpdateChannelForApp!;
  },

  async updateBranchMappingAsync(variables: UpdateChannelBranchMappingMutationVariables) {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdateChannelBranchMappingMutation>(
          gql`
            mutation UpdateChannelBranchMapping($channelId: ID!, $branchMapping: String!) {
              updateChannel {
                editUpdateChannel(channelId: $channelId, branchMapping: $branchMapping) {
                  id
                  name
                  createdAt
                  branchMapping
                  updateBranches(offset: 0, limit: 25) {
                    id
                    name
                  }
                }
              }
            }
          `,
          variables
        )
        .toPromise()
    );
    return data.updateChannel.editUpdateChannel!;
  },
};

export { ChannelMutation };
