import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateBulkEnvironmentVariablesForAppMutation,
  CreateEnvironmentVariableForAccountMutation,
  CreateEnvironmentVariableForAppMutation,
  CreateEnvironmentVariableInput,
  CreateSharedEnvironmentVariableInput,
  DeleteEnvironmentVariableMutation,
  EnvironmentVariableFragment,
  UpdateEnvironmentVariableInput,
  UpdateEnvironmentVariableMutation,
} from '../generated';
import { EnvironmentVariableFragmentNode } from '../types/EnvironmentVariable';

export const EnvironmentVariableMutation = {
  async createSharedVariableAsync(
    graphqlClient: ExpoGraphqlClient,
    input: CreateSharedEnvironmentVariableInput,
    accountId: string
  ): Promise<EnvironmentVariableFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateEnvironmentVariableForAccountMutation>(
          gql`
            mutation CreateEnvironmentVariableForAccount(
              $input: CreateSharedEnvironmentVariableInput!
              $accountId: ID!
            ) {
              environmentVariable {
                createEnvironmentVariableForAccount(
                  environmentVariableData: $input
                  accountId: $accountId
                ) {
                  id
                  ...EnvironmentVariableFragment
                }
              }
            }
            ${print(EnvironmentVariableFragmentNode)}
          `,
          { input, accountId }
        )
        .toPromise()
    );

    return data.environmentVariable.createEnvironmentVariableForAccount;
  },
  async createForAppAsync(
    graphqlClient: ExpoGraphqlClient,
    input: CreateEnvironmentVariableInput,
    appId: string
  ): Promise<EnvironmentVariableFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateEnvironmentVariableForAppMutation>(
          gql`
            mutation CreateEnvironmentVariableForApp(
              $input: CreateEnvironmentVariableInput!
              $appId: ID!
            ) {
              environmentVariable {
                createEnvironmentVariableForApp(environmentVariableData: $input, appId: $appId) {
                  id
                  ...EnvironmentVariableFragment
                }
              }
            }
            ${print(EnvironmentVariableFragmentNode)}
          `,
          { input, appId }
        )
        .toPromise()
    );

    return data.environmentVariable.createEnvironmentVariableForApp;
  },
  async updateAsync(
    graphqlClient: ExpoGraphqlClient,
    input: UpdateEnvironmentVariableInput
  ): Promise<EnvironmentVariableFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdateEnvironmentVariableMutation>(
          gql`
            mutation UpdateEnvironmentVariable($input: UpdateEnvironmentVariableInput!) {
              environmentVariable {
                updateEnvironmentVariable(environmentVariableData: $input) {
                  id
                  ...EnvironmentVariableFragment
                }
              }
            }
            ${print(EnvironmentVariableFragmentNode)}
          `,
          { input }
        )
        .toPromise()
    );

    return data.environmentVariable.updateEnvironmentVariable;
  },
  async deleteAsync(graphqlClient: ExpoGraphqlClient, id: string): Promise<{ id: string }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteEnvironmentVariableMutation>(
          gql`
            mutation DeleteEnvironmentVariable($id: ID!) {
              environmentVariable {
                deleteEnvironmentVariable(id: $id) {
                  id
                }
              }
            }
          `,
          { id }
        )
        .toPromise()
    );

    return data.environmentVariable.deleteEnvironmentVariable;
  },
  async createBulkEnvironmentVariablesForAppAsync(
    graphqlClient: ExpoGraphqlClient,
    input: CreateEnvironmentVariableInput[],
    appId: string
  ): Promise<boolean> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateBulkEnvironmentVariablesForAppMutation>(
          gql`
            mutation CreateBulkEnvironmentVariablesForApp(
              $input: [CreateEnvironmentVariableInput!]!
              $appId: ID!
            ) {
              environmentVariable {
                createBulkEnvironmentVariablesForApp(environmentVariablesData: $input, appId: $appId) {
                  id
                }
              }
            }
          `,
          { input, appId }
        )
        .toPromise()
    );

    return true;
  },
};
