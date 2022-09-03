import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  UpdateBranchFragment,
  ViewUpdateGroupsOnAppQuery,
  ViewUpdateGroupsOnAppQueryVariables,
  ViewUpdateGroupsOnBranchQuery,
  ViewUpdateGroupsOnBranchQueryVariables,
  ViewUpdatesByGroupQuery,
  ViewUpdatesByGroupQueryVariables,
} from '../generated';

export type BranchUpdateObject = UpdateBranchFragment['updates'][number];

export type BranchUpdateGroupObject = Exclude<
  ViewUpdateGroupsOnBranchQuery['app']['byId']['updateBranchByName'],
  null | undefined
>['updateGroups'][number];

export type AppUpdateGroupObject = Exclude<
  ViewUpdateGroupsOnAppQuery['app']['byId'],
  null | undefined
>['updateGroups'][number];

export type UpdateByGroupObject = Exclude<
  ViewUpdatesByGroupQuery['updatesByGroup'],
  null | undefined
>;

export type UpdateGroupObject =
  | UpdateByGroupObject
  | AppUpdateGroupObject
  | BranchUpdateGroupObject;

export const UpdateQuery = {
  async viewUpdateGroupAsync({ groupId }: { groupId: string }): Promise<UpdateByGroupObject> {
    const { updatesByGroup } = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdatesByGroupQuery, ViewUpdatesByGroupQueryVariables>(
          gql`
            query ViewUpdatesByGroup($groupId: ID!) {
              updatesByGroup(group: $groupId) {
                id
                group
                runtimeVersion
                platform
                message
                createdAt
                manifestFragment
                actor {
                  __typename
                  id
                  ... on User {
                    username
                  }
                  ... on Robot {
                    firstName
                  }
                }
                branch {
                  id
                  name
                }
              }
            }
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
  }: ViewUpdateGroupsOnBranchQueryVariables): Promise<BranchUpdateGroupObject[]> {
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
                      group
                      message
                      createdAt
                      runtimeVersion
                      platform
                      manifestFragment
                      actor {
                        __typename
                        id
                        ... on User {
                          username
                        }
                        ... on Robot {
                          firstName
                        }
                      }
                      branch {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
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
  }: ViewUpdateGroupsOnAppQueryVariables): Promise<AppUpdateGroupObject[]> {
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
                    group
                    message
                    createdAt
                    runtimeVersion
                    platform
                    manifestFragment
                    actor {
                      __typename
                      id
                      ... on User {
                        username
                      }
                      ... on Robot {
                        firstName
                      }
                    }
                    branch {
                      id
                      name
                    }
                  }
                }
              }
            }
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
      throw new Error(`Could not find app with id "${appId}"`);
    }

    return response.app.byId.updateGroups;
  },
};
