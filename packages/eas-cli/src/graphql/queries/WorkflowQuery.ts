/* eslint-disable graphql/template-strings */
import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { WorkflowRun, WorkflowRunsForWorkflowIdQuery } from '../generated';
import { WorkflowRunsFragmentNode } from '../types/Workflow';

export const WorkflowQuery = {
  async byIdRunsAsync(
    graphqlClient: ExpoGraphqlClient,
    workflowId: string,
    limit?: number
  ): Promise<Partial<WorkflowRun>[]> {
    validateLimit(limit);
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<WorkflowRunsForWorkflowIdQuery>(
          gql`
            query WorkflowRunsForWorkflowIdQuery($workflowId: ID!, $limit: Int!) {
              workflows {
                byId(workflowId: $workflowId) {
                  id
                  ...WorkflowRunsFragment
                }
              }
            }
            ${print(WorkflowRunsFragmentNode)}
          `,
          { workflowId, limit },
          { additionalTypenames: ['Workflow'] }
        )
        .toPromise()
    );
    assert(data.workflows, 'GraphQL: `workflows` not defined in server response');
    return data.workflows.byId.runs.edges.map(edge => edge.node as Partial<WorkflowRun>) ?? [];
  },
};

function validateLimit(limit?: number): void {
  assert(limit, 'limit is required');
  assert(limit > 0, 'limit must be greater than 0');
  assert(limit <= 100, 'limit must be less than or equal to 100');
}
