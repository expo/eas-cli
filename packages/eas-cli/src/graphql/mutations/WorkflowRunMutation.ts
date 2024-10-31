import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateWorkflowRunMutation,
  CreateWorkflowRunMutationVariables,
  WorkflowRevisionInput,
  WorkflowRunInput,
} from '../generated';

export namespace WorkflowRunMutation {
  export async function createWorkflowRunAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      workflowRevisionInput,
      workflowRunInput,
    }: {
      appId: string;
      workflowRevisionInput: WorkflowRevisionInput;
      workflowRunInput: WorkflowRunInput;
    }
  ): Promise<{ id: string }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateWorkflowRunMutation, CreateWorkflowRunMutationVariables>(
          gql`
            mutation CreateWorkflowRun(
              $appId: ID!
              $workflowRevisionInput: WorkflowRevisionInput!
              $workflowRunInput: WorkflowRunInput!
            ) {
              workflowRun {
                createWorkflowRun(
                  appId: $appId
                  workflowRevisionInput: $workflowRevisionInput
                  workflowRunInput: $workflowRunInput
                ) {
                  id
                }
              }
            }
          `,
          {
            appId,
            workflowRevisionInput,
            workflowRunInput,
          }
        )
        .toPromise()
    );
    return { id: data.workflowRun.createWorkflowRun.id };
  }
}
