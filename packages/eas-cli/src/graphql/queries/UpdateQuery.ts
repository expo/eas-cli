import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  ViewAllUpdatesQuery,
  ViewAllUpdatesQueryVariables,
  ViewBranchUpdatesQuery,
  ViewBranchUpdatesQueryVariables,
  ViewUpdateGroupsForAppQuery,
  ViewUpdateGroupsForAppQueryVariables,
  ViewUpdateGroupsOnBranchForAppQuery,
  ViewUpdateGroupsOnBranchForAppQueryVariables,
  ViewUpdatesByGroupQuery,
  ViewUpdatesByGroupQueryVariables,
} from '../generated';

export type BranchUpdateObject = Exclude<
  ViewBranchUpdatesQuery['app']['byId']['updateBranchByName'],
  null | undefined
>['updates'][number];

export type BranchUpdateGroupObject = Exclude<
  ViewUpdateGroupsOnBranchForAppQuery['app']['byId']['updateBranchByName'],
  null | undefined
>['updateGroups'][number];

export type AppUpdateGroupObject = Exclude<
  ViewUpdateGroupsForAppQuery['app']['byId'],
  null | undefined
>['updateGroups'][number];

export type UpdateByGroupObject = ViewUpdatesByGroupQuery['updatesByGroup'];

export type AppUpdateObject = ViewAllUpdatesQuery['app']['byId']['updates'][number];

export type UpdateObject = BranchUpdateObject | AppUpdateObject;

export type UpdateGroupObject =
  | UpdateByGroupObject
  | AppUpdateGroupObject
  | BranchUpdateGroupObject;

export const UpdateQuery = {
  async viewAllAsync({ appId, limit, offset }: ViewAllUpdatesQueryVariables) {
    return withErrorHandlingAsync(
      graphqlClient
        .query<ViewAllUpdatesQuery, ViewAllUpdatesQueryVariables>(
          gql`
            query ViewAllUpdates($appId: String!, $limit: Int!, $offset: Int!) {
              app {
                byId(appId: $appId) {
                  id
                  updates(limit: $limit, offset: $offset) {
                    id
                    group
                    message
                    createdAt
                    runtimeVersion
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
          },
          { additionalTypenames: ['UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
  },
  async viewBranchAsync({ appId, name, limit, offset }: ViewBranchUpdatesQueryVariables) {
    return withErrorHandlingAsync(
      graphqlClient
        .query<ViewBranchUpdatesQuery, ViewBranchUpdatesQueryVariables>(
          gql`
            query ViewBranchUpdates($appId: String!, $name: String!, $limit: Int!, $offset: Int!) {
              app {
                byId(appId: $appId) {
                  id
                  updateBranchByName(name: $name) {
                    id
                    name
                    updates(limit: $limit, offset: $offset) {
                      id
                      group
                      message
                      createdAt
                      runtimeVersion
                      platform
                      manifestFragment
                      actor {
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
            name,
            limit,
            offset,
          },
          { additionalTypenames: ['UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
  },
  async viewUpdateGroupAsync({ groupId }: { groupId: string }): Promise<ViewUpdatesByGroupQuery> {
    return await withErrorHandlingAsync(
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
  },
  async viewUpdateGroupsOnBranchAsync({
    limit,
    offset,
    appId,
    branchName,
    filter,
  }: ViewUpdateGroupsOnBranchForAppQueryVariables): Promise<ViewUpdateGroupsOnBranchForAppQuery> {
    return await withErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdateGroupsOnBranchForAppQuery, ViewUpdateGroupsOnBranchForAppQueryVariables>(
          gql`
            query ViewUpdateGroupsOnBranchForApp(
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
  },
  async viewUpdateGroupsAsync({
    limit,
    offset,
    appId,
    filter,
  }: ViewUpdateGroupsForAppQueryVariables): Promise<ViewUpdateGroupsForAppQuery> {
    return await withErrorHandlingAsync(
      graphqlClient
        .query<ViewUpdateGroupsForAppQuery, ViewUpdateGroupsForAppQueryVariables>(
          gql`
            query ViewUpdateGroupsForApp(
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
  },
};
