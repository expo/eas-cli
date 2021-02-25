import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  GetChannelByNameForAppQuery,
  GetChannelByNameForAppQueryVariables,
  ListChannelsForAppQuery,
  ListChannelsForAppQueryVariables,
} from '../generated';

type Filters = {
  limit?: number;
  offset?: number;
};

const ChannelQuery = {
  async byNameForAppAsync(variables: GetChannelByNameForAppQueryVariables) {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GetChannelByNameForAppQuery>(
          gql`
            query GetChannelByNameForApp($appId: String!, $name: String!) {
              app {
                byId(appId: $appId) {
                  id
                  name
                  updateChannelByName(name: $name) {
                    id
                    name
                    createdAt
                    updateBranches(offset: 0, limit: 25) {
                      id
                      name
                      updates(offset: 0, limit: 25) {
                        id
                        group
                        message
                        createdAt
                        actor {
                          id
                          ... on User {
                            firstName
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
          variables
        )
        .toPromise()
    );

    return data.app?.byId.updateChannelByName!;
  },

  async allForAppAsync(
    variables: Pick<ListChannelsForAppQueryVariables, 'appId'>,
    filters: Filters = {}
  ) {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<ListChannelsForAppQuery>(
          gql`
            query ListChannelsForApp($appId: String!, $offset: Int!, $limit: Int!) {
              app {
                byId(appId: $appId) {
                  id
                  name
                  updateChannels(offset: $offset, limit: $limit) {
                    id
                    name
                    updateBranches(offset: 0, limit: 25) {
                      id
                      name
                      updates(offset: 0, limit: 25) {
                        id
                        group
                        message
                        createdAt
                        actor {
                          id
                          ... on User {
                            firstName
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
          {
            ...variables,
            offset: filters.offset || 0,
            limit: filters.limit || 25,
          }
        )
        .toPromise()
    );

    return data.app?.byId.updateChannels!;
  },
};

export { ChannelQuery };
