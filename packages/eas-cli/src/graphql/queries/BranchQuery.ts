import { print } from 'graphql';
import gql from 'graphql-tag';

import { BranchNotFoundError } from '../../branch/utils';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppPlatform,
  BranchesBasicPaginatedOnAppQuery,
  BranchesBasicPaginatedOnAppQueryVariables,
  BranchesByAppQuery,
  BranchesByAppQueryVariables,
  UpdateBranchBasicInfoFragment,
  UpdateBranchFragment,
  ViewBranchQuery,
  ViewBranchQueryVariables,
  ViewBranchesOnUpdateChannelQuery,
  ViewBranchesOnUpdateChannelQueryVariables,
  ViewLatestUpdateOnBranchQuery,
  ViewLatestUpdateOnBranchQueryVariables,
} from '../generated';
import { UpdateFragmentNode } from '../types/Update';
import { UpdateBranchFragmentNode } from '../types/UpdateBranch';
import { UpdateBranchBasicInfoFragmentNode } from '../types/UpdateBranchBasicInfo';

export type UpdateBranchOnChannelObject = NonNullable<
  ViewBranchesOnUpdateChannelQuery['app']['byId']['updateChannelByName']
>['updateBranches'][number];

export const BranchQuery = {
  async getBranchByNameAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, name }: ViewBranchQueryVariables
  ): Promise<UpdateBranchBasicInfoFragment> {
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
                    ...UpdateBranchBasicInfoFragment
                  }
                }
              }
            }
            ${print(UpdateBranchBasicInfoFragmentNode)}
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
  async getLatestUpdateIdOnBranchAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      branchName,
      platform,
      runtimeVersion,
    }: { appId: string; branchName: string; platform: AppPlatform; runtimeVersion: string }
  ): Promise<string | null> {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewLatestUpdateOnBranchQuery, ViewLatestUpdateOnBranchQueryVariables>(
          gql`
            query ViewLatestUpdateOnBranch(
              $appId: String!
              $branchName: String!
              $platform: AppPlatform!
              $runtimeVersion: String!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  updateBranchByName(name: $branchName) {
                    id
                    updates(
                      offset: 0
                      limit: 1
                      filter: { platform: $platform, runtimeVersions: [$runtimeVersion] }
                    ) {
                      id
                    }
                  }
                }
              }
            }
          `,
          {
            appId,
            branchName,
            platform,
            runtimeVersion,
          },
          { additionalTypenames: ['UpdateBranch'] }
        )
        .toPromise()
    );
    const { updateBranchByName } = response.app.byId;
    if (!updateBranchByName) {
      throw new BranchNotFoundError(`Could not find a branch named "${branchName}".`);
    }
    const latestUpdate = updateBranchByName.updates[0];
    if (!latestUpdate) {
      return null;
    }
    return latestUpdate.id;
  },
  async listBranchesOnAppAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, limit, offset }: BranchesByAppQueryVariables
  ): Promise<UpdateBranchFragment[]> {
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
  async listBranchesBasicInfoPaginatedOnAppAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, first, after, last, before }: BranchesBasicPaginatedOnAppQueryVariables
  ): Promise<BranchesBasicPaginatedOnAppQuery['app']['byId']['branchesPaginated']> {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<BranchesBasicPaginatedOnAppQuery, BranchesBasicPaginatedOnAppQueryVariables>(
          gql`
            query BranchesBasicPaginatedOnApp(
              $appId: String!
              $first: Int
              $after: String
              $last: Int
              $before: String
            ) {
              app {
                byId(appId: $appId) {
                  id
                  branchesPaginated(first: $first, after: $after, before: $before, last: $last) {
                    edges {
                      node {
                        id
                        ...UpdateBranchBasicInfoFragment
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
            ${print(UpdateBranchBasicInfoFragmentNode)}
          `,
          { appId, first, after, last, before },
          { additionalTypenames: ['UpdateBranch'] }
        )
        .toPromise()
    );
    const { branchesPaginated } = response.app.byId;

    if (!branchesPaginated) {
      throw new Error(`Could not find channels on project with id ${appId}`);
    }
    return branchesPaginated;
  },
  async listBranchesOnChannelAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, channelName, offset, limit }: ViewBranchesOnUpdateChannelQueryVariables
  ): Promise<UpdateBranchOnChannelObject[]> {
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
