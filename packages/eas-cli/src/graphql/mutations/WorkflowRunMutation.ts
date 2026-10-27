import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CancelWorkflowRunMutation,
  CancelWorkflowRunMutationVariables,
  CreateWorkflowRunFromGitRefMutation,
  CreateWorkflowRunFromGitRefMutationVariables,
  CreateWorkflowRunMutation,
  CreateWorkflowRunMutationVariables,
  WorkflowProjectSourceInput,
  WorkflowRevisionInput,
  WorkflowRunInput,
  WorkflowRunSshInput,
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

  export async function createWorkflowRunFromGitRefAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      workflowRevisionId,
      gitRef,
      inputs,
      ssh,
    }: {
      workflowRevisionId: string;
      gitRef: string;
      inputs?: Record<string, any>;
      ssh?: WorkflowRunSshInput | null;
    }
  ): Promise<{ id: string }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          CreateWorkflowRunFromGitRefMutation,
          CreateWorkflowRunFromGitRefMutationVariables
        >(
          gql`
            mutation CreateWorkflowRunFromGitRef(
              $workflowRevisionId: ID!
              $gitRef: String!
              $inputs: JSONObject
              $ssh: WorkflowRunSshInput
            ) {
              workflowRun {
                createWorkflowRunFromGitRef(
                  workflowRevisionId: $workflowRevisionId
                  gitRef: $gitRef
                  inputs: $inputs
                  ssh: $ssh
                ) {
                  id
                }
              }
            }
          `,
          {
            workflowRevisionId,
            gitRef,
            inputs,
            ssh,
          }
        )
        .toPromise()
    );
    return { id: data.workflowRun.createWorkflowRunFromGitRef.id };
  }

  export async function createExpoGoRepackWorkflowRunAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      sdkVersion,
      projectSource,
    }: {
      appId: string;
      sdkVersion?: string;
      projectSource: WorkflowProjectSourceInput;
    }
  ): Promise<{ id: string }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          { workflowRun: { createExpoGoRepackWorkflowRun: { id: string } } },
          { appId: string; projectSource: WorkflowProjectSourceInput; sdkVersion?: string }
        >(
          /* eslint-disable graphql/template-strings */
          gql`
            mutation CreateExpoGoRepackWorkflowRun(
              $appId: ID!
              $projectSource: WorkflowProjectSourceInput!
              $sdkVersion: String
            ) {
              workflowRun {
                createExpoGoRepackWorkflowRun(
                  appId: $appId
                  projectSource: $projectSource
                  sdkVersion: $sdkVersion
                ) {
                  id
                }
              }
            }
          `,
          /* eslint-enable graphql/template-strings */
          { appId, projectSource, sdkVersion }
        )
        .toPromise()
    );
    return { id: data.workflowRun.createExpoGoRepackWorkflowRun.id };
  }

  export async function cancelWorkflowRunAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      workflowRunId,
    }: {
      workflowRunId: string;
    }
  ): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<CancelWorkflowRunMutation, CancelWorkflowRunMutationVariables>(
          gql`
            mutation CancelWorkflowRun($workflowRunId: ID!) {
              workflowRun {
                cancelWorkflowRun(workflowRunId: $workflowRunId) {
                  id
                }
              }
            }
          `,
          {
            workflowRunId,
          }
        )
        .toPromise()
    );
  }
}
