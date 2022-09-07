import { print } from 'graphql';
import gql from 'graphql-tag';

import { BranchNotFoundError } from '../../branch/utils';
import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  BranchesByAppQuery,
  BranchesByAppQueryVariables,
  UpdateBranchFragment,
  ViewBranchQuery,
  ViewBranchQueryVariables,
  ViewBranchesOnUpdateChannelQuery,
  ViewBranchesOnUpdateChannelQueryVariables,
} from '../generated';
import { UpdateFragmentNode } from '../types/Update';
import { UpdateBranchFragmentNode } from '../types/UpdateBranch';

export type UpdateBranchOnChannelObject = NonNullable<
  ViewBranchesOnUpdateChannelQuery['app']['byId']['updateChannelByName']
>['updateBranches'][number];

export const BranchQuery = {
  async getBranchByNameAsync({
    appId,
    name,
  }: ViewBranchQueryVariables): Promise<
    NonNullable<ViewBranchQuery['app']['byId']['updateBranchByName']>
  > {
    const response = await withErrorHandlingAsync<ViewBranchQuery>(
      graphqlClient
        .query<ViewBranchQuery, ViewBranchQueryVariables>(
          gql`
            query ViewBranch($appId: String!, $name: String!) {
              app {
                byId(appId: $appId) {
                  id
                  updateBranchByName(name: $name) {
                    id
                    name
                  }
                }
              }
            }
          `,
          {
            appId,
            name,
          },
          { additionalTypenames: ['UpdateBranch'] }
        )
        .toPromise()
    );
    const { updateBranchByName } = response.app.byId;
    if (!updateBranchByName) {
      throw new BranchNotFoundError(`Could not find a branch named "${name}".`);
    }
    return updateBranchByName;
  },
  async listBranchesOnAppAsync({
    appId,
    limit,
    offset,
  }: BranchesByAppQueryVariables): Promise<UpdateBranchFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<BranchesByAppQuery, BranchesByAppQueryVariables>(
          gql`
            query BranchesByAppQuery($appId: String!, $limit: Int!, $offset: Int!) {
              app {
                byId(appId: $appId) {
                  id
                  updateBranches(limit: $limit, offset: $offset) {
                    id
                    ...UpdateBranchFragment
                  }
                }
              }
            }
            ${print(UpdateBranchFragmentNode)}
          `,
          {
            appId,
            limit,
            offset,
          },
          { additionalTypenames: ['UpdateBranch'] }
        )
        .toPromise()
    );

    return data?.app?.byId.updateBranches ?? [];
  },
  async listBranchesOnChannelAsync({
    appId,
    channelName,
    offset,
    limit,
  }: ViewBranchesOnUpdateChannelQueryVariables): Promise<UpdateBranchOnChannelObject[]> {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewBranchesOnUpdateChannelQuery, ViewBranchesOnUpdateChannelQueryVariables>(
          gql`
            query ViewBranchesOnUpdateChannel(
              $appId: String!
              $channelName: String!
              $offset: Int!
              $limit: Int!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  updateChannelByName(name: $channelName) {
                    id
                    updateBranches(offset: $offset, limit: $limit) {
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
          { appId, channelName, offset, limit },
          { additionalTypenames: ['UpdateChannel', 'UpdateBranch', 'Update'] }
        )
        .toPromise()
    );

    const { updateChannelByName } = response.app.byId;
    if (!updateChannelByName) {
      throw new Error(`Could not find channels with the name ${channelName}`);
    }

    return updateChannelByName.updateBranches;
  },
};
