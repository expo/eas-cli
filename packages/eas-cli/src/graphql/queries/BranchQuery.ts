import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { ViewBranchQuery, ViewBranchQueryVariables } from '../generated';

export const BranchQuery = {
  async getBranchByNameAsync({ appId, name }: { appId: string; name: string }) {
    return await withErrorHandlingAsync<ViewBranchQuery>(
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
  },
};
