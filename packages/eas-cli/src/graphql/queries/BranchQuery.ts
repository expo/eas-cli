import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  BranchesByAppQuery,
  BranchesByAppQueryVariables,
  UpdateBranchFragment,
  ViewBranchQuery,
  ViewBranchQueryVariables,
} from '../generated';
import { UpdateBranchFragmentNode } from '../types/UpdateBranch';

export const BranchQuery = {
  async getBranchByNameAsync({
    appId,
    name,
  }: {
    appId: string;
    name: string;
  }): Promise<ViewBranchQuery['app']['byId']['updateBranchByName']> {
    const {
      app: {
        byId: { updateBranchByName: branch },
      },
    } = await withErrorHandlingAsync<ViewBranchQuery>(
      graphqlClient
        .query<ViewBranchQuery, ViewBranchQueryVariables>(
          gql`
            query ViewBranch($appId: String!, $name: String!) {
              app {
                byId(appId: $appId) {
                  id
                  updateBranchByName(name: $name) {
                    id
                    name
                  }
                }
              }
            }
          `,
          {
            appId,
            name,
          },
          { additionalTypenames: ['UpdateBranch'] }
        )
        .toPromise()
    );
    return branch;
  },
  async listBranchesAsync({
    appId,
    limit,
    offset,
  }: BranchesByAppQueryVariables): Promise<UpdateBranchFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<BranchesByAppQuery, BranchesByAppQueryVariables>(
          gql`
            query BranchesByAppQuery($appId: String!, $limit: Int!, $offset: Int!) {
              app {
                byId(appId: $appId) {
                  id
                  updateBranches(limit: $limit, offset: $offset) {
                    id
                    ...UpdateBranchFragment
                  }
                }
              }
            }
            ${print(UpdateBranchFragmentNode)}
          `,
          {
            appId,
            limit,
            offset,
          },
          { additionalTypenames: ['UpdateBranch'] }
        )
        .toPromise()
    );

    return data?.app?.byId.updateBranches ?? [];
  },
};
