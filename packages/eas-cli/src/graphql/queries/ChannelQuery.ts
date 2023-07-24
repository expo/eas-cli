import { print } from 'graphql';
import gql from 'graphql-tag';

import { ChannelNotFoundError } from '../../channel/errors';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  PageInfo,
  ViewUpdateChannelOnAppQuery,
  ViewUpdateChannelOnAppQueryVariables,
  ViewUpdateChannelsOnAppQuery,
  ViewUpdateChannelsOnAppQueryVariables,
  ViewUpdateChannelsPaginatedOnAppQuery,
  ViewUpdateChannelsPaginatedOnAppQueryVariables,
} from '../generated';
import { UpdateFragmentNode } from '../types/Update';

type ViewUpdateChannelsOnAppObject = NonNullable<
  ViewUpdateChannelsOnAppQuery['app']['byId']['updateChannels']
>[number];

type UpdateChannelByNameObject = NonNullable<
  ViewUpdateChannelOnAppQuery['app']['byId']['updateChannelByName']
>;

// this asserts they are the same thing
export type UpdateChannelObject = ViewUpdateChannelsOnAppObject & UpdateChannelByNameObject;

export type UpdateBranchObject = UpdateChannelObject['updateBranches'][number];

export type UpdateChannelBasicInfo = NonNullable<
  ViewUpdateChannelsPaginatedOnAppQuery['app']['byId']['channelsPaginated']['edges'][0]['node']
>;

export const ChannelQuery = {
  async viewUpdateChannelAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, channelName }: ViewUpdateChannelOnAppQueryVariables
  ): Promise<UpdateChannelByNameObject> {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdateChannelOnAppQuery, ViewUpdateChannelOnAppQueryVariables>(
          gql`
            query ViewUpdateChannelOnApp($appId: String!, $channelName: String!) {
              app {
                byId(appId: $appId) {
                  id
                  updateChannelByName(name: $channelName) {
                    id
                    name
                    createdAt
                    branchMapping
                    updateBranches(offset: 0, limit: 5) {
                      id
                      name
                      updateGroups(offset: 0, limit: 1) {
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

    const { updateChannelByName } = response.app.byId;
    if (!updateChannelByName) {
      throw new ChannelNotFoundError(`Could not find channel with the name ${channelName}`);
    }

    return updateChannelByName;
  },
  async viewUpdateChannelsOnAppAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, limit, offset }: ViewUpdateChannelsOnAppQueryVariables
  ): Promise<UpdateChannelObject[]> {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdateChannelsOnAppQuery, ViewUpdateChannelsOnAppQueryVariables>(
          gql`
            query ViewUpdateChannelsOnApp($appId: String!, $offset: Int!, $limit: Int!) {
              app {
                byId(appId: $appId) {
                  id
                  updateChannels(offset: $offset, limit: $limit) {
                    id
                    name
                    createdAt
                    branchMapping
                    updateBranches(offset: 0, limit: 5) {
                      id
                      name
                      updateGroups(offset: 0, limit: 1) {
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
          { appId, offset, limit },
          { additionalTypenames: ['UpdateChannel', 'UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
    const { updateChannels } = response.app.byId;

    if (!updateChannels) {
      throw new Error(`Could not find channels on project with id ${appId}`);
    }

    return updateChannels;
  },
  async viewUpdateChannelsBasicInfoPaginatedOnAppAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, first, after }: ViewUpdateChannelsPaginatedOnAppQueryVariables
  ): Promise<[UpdateChannelBasicInfo[], PageInfo]> {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<
          ViewUpdateChannelsPaginatedOnAppQuery,
          ViewUpdateChannelsPaginatedOnAppQueryVariables
        >(
          gql`
            query ViewUpdateChannelsPaginatedOnApp($appId: String!, $first: Int, $after: String) {
              app {
                byId(appId: $appId) {
                  id
                  channelsPaginated(first: $first, after: $after) {
                    edges {
                      node {
                        id
                        name
                        branchMapping
                      }
                    }
                    pageInfo {
                      hasNextPage
                      hasPreviousPage
                      startCursor
                      endCursor
                    }
                  }
                }
              }
            }
          `,
          { appId, first, after },
          { additionalTypenames: ['UpdateChannel', 'UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
    const { channelsPaginated } = response.app.byId;

    if (!channelsPaginated) {
      throw new Error(`Could not find channels on project with id ${appId}`);
    }

    return [channelsPaginated.edges.map(edge => edge.node) ?? [], channelsPaginated.pageInfo];
  },
};
