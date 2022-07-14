import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  ViewAllUpdatesQuery,
  ViewAllUpdatesQueryVariables,
  ViewBranchUpdatesQuery,
  ViewBranchUpdatesQueryVariables,
} from '../generated';

export type BranchUpdateObject = Exclude<
  ViewBranchUpdatesQuery['app']['byId']['updateBranchByName'],
  null | undefined
>['updates'][number];

export type AppUpdateObject = ViewAllUpdatesQuery['app']['byId']['updates'][number];

export type UpdateObject = BranchUpdateObject | AppUpdateObject;

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
};
