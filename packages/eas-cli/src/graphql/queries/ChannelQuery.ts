import { print } from 'graphql';
import gql from 'graphql-tag';

import { ChannelNotFoundError } from '../../channel/errors';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  ViewUpdateChannelOnAppQuery,
  ViewUpdateChannelOnAppQueryVariables,
  ViewUpdateChannelsOnAppQuery,
  ViewUpdateChannelsOnAppQueryVariables,
} from '../generated';
import { UpdateFragmentNode } from '../types/Update';

export type UpdateChannelObject = NonNullable<
  ViewUpdateChannelsOnAppQuery['app']['byId']['updateChannels']
>[number];

export type UpdateChannelByNameObject = NonNullable<
  ViewUpdateChannelOnAppQuery['app']['byId']['updateChannelByName']
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
  async viewUpdateChannelsPaginatedOnAppAsync(
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
                    branchMapping
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
};
