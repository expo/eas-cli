import gql from 'graphql-tag';
import { z } from 'zod';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  ValidateWorkflowYamlConfigMutation,
  ValidateWorkflowYamlConfigMutationVariables,
} from '../generated';

export namespace WorkflowRevisionMutation {
  export const ValidationErrorExtensionZ = z.object({
    errorCode: z.literal('VALIDATION_ERROR'),
    metadata: z.object({
      formErrors: z.array(z.string()),
      fieldErrors: z.record(z.string(), z.array(z.string())),
    }),
  });

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
