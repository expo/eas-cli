import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  UpdateByIdQuery,
  UpdateByIdQueryVariables,
  UpdateFragment,
  ViewUpdateGroupsOnAppQuery,
  ViewUpdateGroupsOnAppQueryVariables,
  ViewUpdateGroupsOnBranchQuery,
  ViewUpdateGroupsOnBranchQueryVariables,
  ViewUpdatesByGroupQuery,
  ViewUpdatesByGroupQueryVariables,
} from '../generated';
import { UpdateFragmentNode } from '../types/Update';

export const UpdateQuery = {
  async viewUpdateGroupAsync(
    graphqlClient: ExpoGraphqlClient,
    { groupId }: ViewUpdatesByGroupQueryVariables
  ): Promise<UpdateFragment[]> {
    const { updatesByGroup } = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdatesByGroupQuery, ViewUpdatesByGroupQueryVariables>(
          gql`
            query ViewUpdatesByGroup($groupId: ID!) {
              updatesByGroup(group: $groupId) {
                id
                ...UpdateFragment
              }
            }
            ${print(UpdateFragmentNode)}
          `,
          {
            groupId,
          },
          { additionalTypenames: ['Update'] }
        )
        .toPromise()
    );

    if (updatesByGroup.length === 0) {
      throw new Error(`Could not find any updates with group ID: "${groupId}"`);
    }

    return updatesByGroup;
  },
  async viewUpdateGroupsOnBranchAsync(
    graphqlClient: ExpoGraphqlClient,
    { limit, offset, appId, branchName, filter }: ViewUpdateGroupsOnBranchQueryVariables
  ): Promise<UpdateFragment[][]> {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdateGroupsOnBranchQuery, ViewUpdateGroupsOnBranchQueryVariables>(
          gql`
            query ViewUpdateGroupsOnBranch(
              $appId: String!
              $branchName: String!
              $limit: Int!
              $offset: Int!
              $filter: UpdatesFilter
            ) {
              app {
                byId(appId: $appId) {
                  id
                  updateBranchByName(name: $branchName) {
                    id
                    updateGroups(limit: $limit, offset: $offset, filter: $filter) {
                      id
                      ...UpdateFragment
                    }
                  }
                }
              }
            }
            ${print(UpdateFragmentNode)}
          `,
          {
            appId,
            limit,
            offset,
            branchName,
            filter,
          },
          { additionalTypenames: ['Update'] }
        )
        .toPromise()
    );
    const branch = response.app.byId.updateBranchByName;

    if (!branch) {
      throw new Error(`Could not find branch "${branchName}"`);
    }

    return branch.updateGroups;
  },
  async viewUpdateGroupsOnAppAsync(
    graphqlClient: ExpoGraphqlClient,
    { limit, offset, appId, filter }: ViewUpdateGroupsOnAppQueryVariables
  ): Promise<UpdateFragment[][]> {
    const response = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdateGroupsOnAppQuery, ViewUpdateGroupsOnAppQueryVariables>(
          gql`
            query ViewUpdateGroupsOnApp(
              $appId: String!
              $limit: Int!
              $offset: Int!
              $filter: UpdatesFilter
            ) {
              app {
                byId(appId: $appId) {
                  id
                  updateGroups(limit: $limit, offset: $offset, filter: $filter) {
                    id
                    ...UpdateFragment
                  }
                }
              }
            }
            ${print(UpdateFragmentNode)}
          `,
          {
            appId,
            limit,
            offset,
            filter,
          },
          { additionalTypenames: ['Update'] }
        )
        .toPromise()
    );

    if (!response) {
      throw new Error(`Could not find project with id "${appId}"`);
    }

    return response.app.byId.updateGroups;
  },
  async viewByUpdateAsync(
    graphqlClient: ExpoGraphqlClient,
    { updateId }: UpdateByIdQueryVariables
  ): Promise<UpdateFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<UpdateByIdQuery, UpdateByIdQueryVariables>(
          gql`
            query UpdateByIdQuery($updateId: ID!) {
              updates {
                byId(updateId: $updateId) {
                  id
                  ...UpdateFragment
                }
              }
            }
            ${print(UpdateFragmentNode)}
          `,
          { updateId },
          { additionalTypenames: ['Update'] }
        )
        .toPromise()
    );

    return data.updates.byId;
  },
};
