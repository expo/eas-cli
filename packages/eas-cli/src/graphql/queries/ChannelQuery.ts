import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { GetChannelByNameForAppQuery, GetChannelByNameForAppQueryVariables } from '../generated';

const BRANCHES_LIMIT = 50;

export const ChannelQuery = {
  async getUpdateChannelByNameForAppAsync({
    appId,
    channelName,
    offset = 0,
    limit = BRANCHES_LIMIT,
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
            query GetChannelByNameForApp(
              $appId: String!
              $channelName: String!
              $limit: Int!
              $offset: Int!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  updateChannelByName(name: $channelName) {
                    id
                    name
                    createdAt
                    branchMapping
                    updateBranches(offset: $offset, limit: $limit) {
                      id
                      name
                      updates(offset: 0, limit: 1) {
                        id
                        group
                        message
                        runtimeVersion
                        createdAt
                        platform
                        actor {
                          id
                          ... on User {
                            username
                          }
                          ... on Robot {
                            firstName
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          { appId, channelName, offset, limit },
          { additionalTypenames: ['UpdateChannel', 'UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
    return updateChannelByName;
  },
};
