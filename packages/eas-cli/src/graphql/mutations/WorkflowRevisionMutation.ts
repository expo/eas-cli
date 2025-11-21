import gql from 'graphql-tag';
import { z } from 'zod';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  GetOrCreateWorkflowRevisionFromGitRefMutation,
  GetOrCreateWorkflowRevisionFromGitRefMutationVariables,
  GetWorkflowRevisionsFromGitRefMutation,
  GetWorkflowRevisionsFromGitRefMutationVariables,
  ValidateWorkflowYamlConfigMutation,
  ValidateWorkflowYamlConfigMutationVariables,
  WorkflowRevision,
} from '../generated';

export namespace WorkflowRevisionMutation {
  export const ValidationErrorExtensionZ = z.object({
    errorCode: z.literal('VALIDATION_ERROR'),
    metadata: z.object({
      formErrors: z.array(z.string()),
      fieldErrors: z.record(z.string(), z.array(z.string())),
    }),
  });
  export async function getWorkflowRevisionsFromGitRefAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      gitRef,
    }: {
      appId: string;
      gitRef: string;
    }
  ): Promise<WorkflowRevision[] | undefined> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          GetWorkflowRevisionsFromGitRefMutation,
          GetWorkflowRevisionsFromGitRefMutationVariables
        >(
          gql`
            mutation GetWorkflowRevisionsFromGitRef($appId: ID!, $gitRef: String!) {
              workflowRevision {
                getWorkflowRevisionsFromGitRef(appId: $appId, gitRef: $gitRef) {
                  id
                  yamlConfig
                  blobSha
                  commitSha
                  createdAt
                  workflow {
                    id
                    app {
                      id
                      name
                      slug
                    }
                    fileName
                  }
                }
              }
            }
          `,
          {
            appId,
            gitRef,
          }
        )
        .toPromise()
    );
    return (data.workflowRevision?.getWorkflowRevisionsFromGitRef as WorkflowRevision[]) ?? [];
  }
  export async function getOrCreateWorkflowRevisionFromGitRefAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      fileName,
      gitRef,
    }: {
      appId: string;
      fileName: string;
      gitRef: string;
    }
  ): Promise<WorkflowRevision | undefined> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          GetOrCreateWorkflowRevisionFromGitRefMutation,
          GetOrCreateWorkflowRevisionFromGitRefMutationVariables
        >(
          gql`
            mutation GetOrCreateWorkflowRevisionFromGitRef(
              $appId: ID!
              $fileName: String!
              $gitRef: String!
            ) {
              workflowRevision {
                getOrCreateWorkflowRevisionFromGitRef(
                  appId: $appId
                  fileName: $fileName
                  gitRef: $gitRef
                ) {
                  id
                  yamlConfig
                  blobSha
                  commitSha
                  createdAt
                  workflow {
                    id
                  }
                }
              }
            }
          `,
          {
            appId,
            fileName,
            gitRef,
          }
        )
        .toPromise()
    );
    return (
      (data.workflowRevision?.getOrCreateWorkflowRevisionFromGitRef as WorkflowRevision) ??
      undefined
    );
  }
  export async function validateWorkflowYamlConfigAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      yamlConfig,
    }: {
      appId: string;
      yamlConfig: string;
    }
  ): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<ValidateWorkflowYamlConfigMutation, ValidateWorkflowYamlConfigMutationVariables>(
          gql`
            mutation ValidateWorkflowYamlConfig($appId: ID!, $yamlConfig: String!) {
              workflowRevision {
                validateWorkflowYamlConfig(appId: $appId, yamlConfig: $yamlConfig)
              }
            }
          `,
          {
            appId,
            yamlConfig,
          }
        )
        .toPromise()
    );
  }
}
