import { print } from 'graphql';
import gql from 'graphql-tag';

import { ChannelNotFoundError } from '../../channel/errors';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  UpdateBranchBasicInfoFragment,
  UpdateFragment,
  ViewUpdateChannelBasicInfoOnAppQuery,
  ViewUpdateChannelBasicInfoOnAppQueryVariables,
  ViewUpdateChannelOnAppQuery,
  ViewUpdateChannelOnAppQueryVariables,
  ViewUpdateChannelsOnAppQuery,
  ViewUpdateChannelsOnAppQueryVariables,
  ViewUpdateChannelsPaginatedOnAppQuery,
  ViewUpdateChannelsPaginatedOnAppQueryVariables,
} from '../generated';
import { UpdateFragmentNode } from '../types/Update';
import { UpdateChannelBasicInfoFragmentNode } from '../types/UpdateChannelBasicInfo';

type ViewUpdateChannelsOnAppObject = NonNullable<
  ViewUpdateChannelsOnAppQuery['app']['byId']['updateChannels']
>[number];

type UpdateChannelByNameObject = NonNullable<
  ViewUpdateChannelOnAppQuery['app']['byId']['updateChannelByName']
>;

// these types should have the same fields
export type UpdateChannelObject = ViewUpdateChannelsOnAppObject & UpdateChannelByNameObject;

export type UpdateBranchObject = UpdateChannelObject['updateBranches'][number];

export function composeUpdateBranchObject(
  branchInfo: UpdateBranchBasicInfoFragment,
  updateGroups: UpdateFragment[][]
): UpdateBranchObject {
  return {
    ...branchInfo,
    updateGroups,
  };
}

export const ChannelQuery = {
  async viewUpdateChannelBasicInfoAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, channelName }: ViewUpdateChannelBasicInfoOnAppQueryVariables
  ): Promise<
    NonNullable<ViewUpdateChannelBasicInfoOnAppQuery['app']['byId']['updateChannelByName']>
  > {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdateChannelBasicInfoOnAppQuery, ViewUpdateChannelBasicInfoOnAppQueryVariables>(
          gql`
            query ViewUpdateChannelBasicInfoOnApp($appId: String!, $channelName: String!) {
              app {
                byId(appId: $appId) {
                  id
                  updateChannelByName(name: $channelName) {
                    id
                    ...UpdateChannelBasicInfoFragment
                  }
                }
              }
            }
            ${print(UpdateChannelBasicInfoFragmentNode)}
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
  async viewUpdateChannelAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, channelName, filter }: ViewUpdateChannelOnAppQueryVariables
  ): Promise<UpdateChannelByNameObject> {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdateChannelOnAppQuery, ViewUpdateChannelOnAppQueryVariables>(
          gql`
            query ViewUpdateChannelOnApp(
              $appId: String!
              $channelName: String!
              $filter: UpdatesFilter
            ) {
              app {
                byId(appId: $appId) {
                  id
                  updateChannelByName(name: $channelName) {
                    id
                    isPaused
                    name
                    updatedAt
                    createdAt
                    branchMapping
                    updateBranches(offset: 0, limit: 5) {
                      id
                      name
                      updateGroups(offset: 0, limit: 1, filter: $filter) {
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
          { appId, channelName, filter },
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
                    isPaused
                    name
                    updatedAt
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
    { appId, first, after, last, before }: ViewUpdateChannelsPaginatedOnAppQueryVariables
  ): Promise<ViewUpdateChannelsPaginatedOnAppQuery['app']['byId']['channelsPaginated']> {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<
          ViewUpdateChannelsPaginatedOnAppQuery,
          ViewUpdateChannelsPaginatedOnAppQueryVariables
        >(
          gql`
            query ViewUpdateChannelsPaginatedOnApp(
              $appId: String!
              $first: Int
              $after: String
              $last: Int
              $before: String
            ) {
              app {
                byId(appId: $appId) {
                  id
                  channelsPaginated(first: $first, after: $after, before: $before, last: $last) {
                    edges {
                      node {
                        id
                        ...UpdateChannelBasicInfoFragment
                      }
                      cursor
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
            ${print(UpdateChannelBasicInfoFragmentNode)}
          `,
          { appId, first, after, last, before },
          { additionalTypenames: ['UpdateChannel', 'UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
    const { channelsPaginated } = response.app.byId;

    if (!channelsPaginated) {
      throw new Error(`Could not find channels on project with id ${appId}`);
    }
    return channelsPaginated;
  },
};
