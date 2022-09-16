import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
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
  async viewUpdateGroupAsync({
    groupId,
  }: ViewUpdatesByGroupQueryVariables): Promise<UpdateFragment[]> {
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
  async viewUpdateGroupsOnBranchAsync({
    limit,
    offset,
    appId,
    branchName,
    filter,
  }: ViewUpdateGroupsOnBranchQueryVariables): Promise<UpdateFragment[][]> {
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
  async viewUpdateGroupsOnAppAsync({
    limit,
    offset,
    appId,
    filter,
  }: ViewUpdateGroupsOnAppQueryVariables): Promise<UpdateFragment[][]> {
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
};
