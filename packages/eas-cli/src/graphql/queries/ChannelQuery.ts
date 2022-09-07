import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { GetChannelByNameForAppQuery, GetChannelByNameForAppQueryVariables } from '../generated';
import { UpdateFragmentNode } from '../types/Update';

export const ChannelQuery = {
  async getUpdateChannelByNameForAppAsync({
    appId,
    channelName,
  }: GetChannelByNameForAppQueryVariables): Promise<
    GetChannelByNameForAppQuery['app']['byId']['updateChannelByName']
  > {
    const {
      app: {
        byId: { updateChannelByName },
      },
    } = await withErrorHandlingAsync(
      graphqlClient
        .query<GetChannelByNameForAppQuery, GetChannelByNameForAppQueryVariables>(
          gql`
            query GetChannelByNameForApp($appId: String!, $channelName: String!) {
              app {
                byId(appId: $appId) {
                  id
                  updateChannelByName(name: $channelName) {
                    id
                    name
                    createdAt
                    branchMapping
                    updateBranches(offset: 0, limit: 1000) {
                      id
                      name
                      updates(offset: 0, limit: 10) {
                        id
                        ...UpdateFragment
                      }
                    }
                  }
                }
              }
            }
            ${print(UpdateFragmentNode)}
          `,
          { appId, channelName },
          { additionalTypenames: ['UpdateChannel', 'UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
    return updateChannelByName;
  },
};
