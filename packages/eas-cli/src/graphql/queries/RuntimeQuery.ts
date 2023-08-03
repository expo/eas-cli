import { print } from 'graphql';
import gql from 'graphql-tag';

import { BranchNotFoundError } from '../../branch/utils';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { Connection } from '../../utils/relay';
import { withErrorHandlingAsync } from '../client';
import {
  RuntimeFragment,
  ViewRuntimesOnBranchQuery,
  ViewRuntimesOnBranchQueryVariables,
} from '../generated';
import { RuntimeFragmentNode } from '../types/Runtime';

export const RuntimeQuery = {
  async getRuntimesOnBranchAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, name, first, after, last, before, filter }: ViewRuntimesOnBranchQueryVariables
  ): Promise<Connection<RuntimeFragment>> {
    const response = await withErrorHandlingAsync<ViewRuntimesOnBranchQuery>(
      graphqlClient
        .query<ViewRuntimesOnBranchQuery, ViewRuntimesOnBranchQueryVariables>(
          gql`
            query ViewRuntimesOnBranch(
              $appId: String!
              $name: String!
              $first: Int
              $after: String
              $last: Int
              $before: String
              $filter: RuntimeFilterInput
            ) {
              app {
                byId(appId: $appId) {
                  id
                  updateBranchByName(name: $name) {
                    id
                    runtimes(
                      first: $first
                      after: $after
                      before: $before
                      last: $last
                      filter: $filter
                    ) {
                      edges {
                        node {
                          id
                          ...RuntimeFragment
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
            }
            ${print(RuntimeFragmentNode)}
          `,
          {
            appId,
            name,
            first,
            after,
            last,
            before,
            filter,
          },
          { additionalTypenames: ['UpdateBranch', 'Runtime'] }
        )
        .toPromise()
    );

    const { updateBranchByName } = response.app.byId;
    if (!updateBranchByName) {
      throw new BranchNotFoundError(`Could not find a branch named "${name}".`);
    }
    return updateBranchByName.runtimes;
  },
};
