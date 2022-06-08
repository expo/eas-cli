import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  ViewAllUpdatesQuery,
  ViewAllUpdatesQueryVariables,
  ViewBranchUpdatesQuery,
  ViewBranchUpdatesQueryVariables,
} from '../generated';

// used for changing the value during testing
export const getViewBranchUpdatesQueryUpdateLimit = (): number => 300;

type ViewBranchUpdatesQueryVariablesWithOptionalLimitAndOffset =
  Partial<ViewBranchUpdatesQueryVariables> &
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
            limit: getViewBranchUpdatesQueryUpdateLimit(),
          },
          { additionalTypenames: ['UpdateBranch', 'Update'] }
        )
        .toPromise()
    );
  },
  async viewBranchAsync({
    appId,
    name,
    limit = getViewBranchUpdatesQueryUpdateLimit(),
    offset = 0,
  }: ViewBranchUpdatesQueryVariablesWithOptionalLimitAndOffset) {
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
