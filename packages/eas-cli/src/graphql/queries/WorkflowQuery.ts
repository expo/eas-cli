import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  WorkflowByAppIdAndFileNameQuery,
  WorkflowByAppIdAndFileNameQueryVariables,
} from '../generated';

export const WorkflowQuery = {
  async byAppIdAndFileNameAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, fileName }: { appId: string; fileName: string }
  ): Promise<{ id: string }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<WorkflowByAppIdAndFileNameQuery, WorkflowByAppIdAndFileNameQueryVariables>(
          gql`
            query WorkflowByAppIdAndFileName($appId: ID!, $fileName: String!) {
              workflows {
                byAppIdAndFileName(appId: $appId, fileName: $fileName) {
                  id
                }
              }
            }
          `,
          { appId, fileName },
          { additionalTypenames: ['Workflow'] }
        )
        .toPromise()
    );
    return data.workflows.byAppIdAndFileName;
  },
};
