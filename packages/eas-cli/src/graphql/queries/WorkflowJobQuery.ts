import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { WorkflowJobByIdQuery, WorkflowJobByIdQueryVariables } from '../generated';
import { WorkflowJobFragmentNode } from '../types/WorkflowJob';

export const WorkflowJobQuery = {
  async byIdAsync(
    graphqlClient: ExpoGraphqlClient,
    workflowJobId: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<WorkflowJobByIdQuery['workflowJobs']['byId']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<WorkflowJobByIdQuery, WorkflowJobByIdQueryVariables>(
          gql`
            query WorkflowJobById($workflowJobId: ID!) {
              workflowJobs {
                byId(workflowJobId: $workflowJobId) {
                  id
                  ...WorkflowJobFragment
                }
              }
            }
            ${print(WorkflowJobFragmentNode)}
          `,
          { workflowJobId },
          {
            requestPolicy: useCache ? 'cache-first' : 'network-only',
            additionalTypenames: ['WorkflowJob'],
          }
        )
        .toPromise()
    );
    return data.workflowJobs.byId;
  },
};
