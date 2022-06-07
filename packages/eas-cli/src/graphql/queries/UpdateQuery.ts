import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  ViewAllUpdatesQuery,
  ViewAllUpdatesQueryVariables,
  ViewBranchUpdatesQuery,
  ViewBranchUpdatesQueryVariables,
} from '../generated';

export const PAGE_LIMIT = 300;

type ViewBranchUpdatesQueryVariablesWithOptionalLimit = Partial<ViewBranchUpdatesQueryVariables> &
  Pick<ViewBranchUpdatesQueryVariables, 'appId' | 'name'>;

export const UpdateQuery = {
  async viewAllAsync({ appId }: { appId: string }): Promise<ViewAllUpdatesQuery> {
    return withErrorHandlingAsync(
      graphqlClient
        .query<ViewAllUpdatesQuery, ViewAllUpdatesQueryVariables>(
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
  async viewBranchAsync({
    appId,
    name,
    limit = PAGE_LIMIT,
  }: ViewBranchUpdatesQueryVariablesWithOptionalLimit) {
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
            limit,
          },
          { additionalTypenames: ['UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
  },
};
