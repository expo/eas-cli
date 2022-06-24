import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  ViewAllUpdatesQuery,
  ViewAllUpdatesQueryVariables,
  ViewBranchUpdatesQuery,
  ViewBranchUpdatesQueryVariables,
} from '../generated';

const UPDATE_LIMIT = 50;

export const UpdateQuery = {
  async viewAllAsync({
    appId,
    limit = UPDATE_LIMIT,
    offset = 0,
  }: ViewAllUpdatesQueryVariables): Promise<ViewAllUpdatesQuery> {
    return withErrorHandlingAsync(
      graphqlClient
        .query<ViewAllUpdatesQuery, ViewAllUpdatesQueryVariables>(
          gql`
            query ViewAllUpdates($appId: String!, $limit: Int!, $offset: Int!) {
              app {
                byId(appId: $appId) {
                  id
                  updates(offset: $offset, limit: $limit) {
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
  async viewBranchAsync({
    appId,
    name,
    limit = UPDATE_LIMIT,
    offset = 0,
  }: ViewBranchUpdatesQueryVariables) {
    return withErrorHandlingAsync<ViewBranchUpdatesQuery>(
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
                    updates(offset: $offset, limit: $limit) {
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
};
