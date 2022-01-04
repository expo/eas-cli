import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { ViewBranchUpdatesQuery, ViewBranchUpdatesQueryVariables } from '../generated';

const PAGE_LIMIT = 10_000;

export const UpdateQuery = {
  async viewAllUpdatesAsync({ appId }: { appId: string }): Promise<any> {
    return withErrorHandlingAsync<any>(
      graphqlClient
        .query<any, any>(
          gql`
            query ViewAllUpdates($appId: String!, $limit: Int!) {
              app {
                byId(appId: $appId) {
                  id
                  updateBranches(offset: 0, limit: $limit) {
                    id
                    name
                    updates(offset: 0, limit: $limit) {
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
            limit: PAGE_LIMIT,
          },
          { additionalTypenames: ['UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
  },
  async viewUpdateBranchAsync({
    appId,
    name,
  }: Pick<ViewBranchUpdatesQueryVariables, 'appId' | 'name'>) {
    return withErrorHandlingAsync<ViewBranchUpdatesQuery>(
      graphqlClient
        .query<ViewBranchUpdatesQuery, ViewBranchUpdatesQueryVariables>(
          gql`
            query ViewBranchUpdates($appId: String!, $name: String!, $limit: Int!) {
              app {
                byId(appId: $appId) {
                  id
                  updateBranchByName(name: $name) {
                    id
                    name
                    updates(offset: 0, limit: $limit) {
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
            limit: PAGE_LIMIT,
          },
          { additionalTypenames: ['UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
  },
};
