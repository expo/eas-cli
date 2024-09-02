import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateBulkEnvironmentVariablesForAppMutation,
  CreateEnvironmentVariableForAccountMutation,
  CreateEnvironmentVariableForAppMutation,
  DeleteEnvironmentVariableMutation,
  EnvironmentVariableFragment,
  EnvironmentVariableVisibility,
  LinkSharedEnvironmentVariableMutation,
  UnlinkSharedEnvironmentVariableMutation,
} from '../generated';
import { EnvironmentVariableFragmentNode } from '../types/EnvironmentVariable';

type UpdateVariableArgs = {
  value?: string;
  name: string;
  overwrite: true;
  visibility?: EnvironmentVariableVisibility;
};

export type EnvironmentVariablePushInput = {
  name: string;
  value: string;
  environment: string;
  visibility: EnvironmentVariableVisibility;
  overwrite?: boolean;
};

export const EnvironmentVariableMutation = {
  async linkSharedEnvironmentVariableAsync(
    graphqlClient: ExpoGraphqlClient,
    environmentVariableId: string,
    appId: string,
    environment: string
  ): Promise<EnvironmentVariableFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<LinkSharedEnvironmentVariableMutation>(
          gql`
            mutation LinkSharedEnvironmentVariable(
              $appId: ID!
              $environment: EnvironmentVariableEnvironment!
              $environmentVariableId: ID!
            ) {
              environmentVariable {
                linkSharedEnvironmentVariable(
                  appId: $appId
                  environmentVariableId: $environmentVariableId
                  environment: $environment
                ) {
                  id
                  ...EnvironmentVariableFragment
                }
              }
            }
            ${print(EnvironmentVariableFragmentNode)}
          `,
          { appId, environment, environmentVariableId }
        )
        .toPromise()
    );

    return data.environmentVariable.linkSharedEnvironmentVariable;
  },
  async unlinkSharedEnvironmentVariableAsync(
    graphqlClient: ExpoGraphqlClient,
    environmentVariableId: string,
    appId: string,
    environment: string
  ): Promise<EnvironmentVariableFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UnlinkSharedEnvironmentVariableMutation>(
          gql`
            mutation UnlinkSharedEnvironmentVariable(
              $appId: ID!
              $environment: EnvironmentVariableEnvironment!
              $environmentVariableId: ID!
            ) {
              environmentVariable {
                unlinkSharedEnvironmentVariable(
                  appId: $appId
                  environmentVariableId: $environmentVariableId
                  environment: $environment
                ) {
                  id
                  ...EnvironmentVariableFragment
                }
              }
            }
            ${print(EnvironmentVariableFragmentNode)}
          `,
          { appId, environment, environmentVariableId }
        )
        .toPromise()
    );

    return data.environmentVariable.unlinkSharedEnvironmentVariable;
  },
  async createSharedVariableAsync(
    graphqlClient: ExpoGraphqlClient,
    input:
      | {
          name: string;
          value: string;
          visibility: EnvironmentVariableVisibility;
          overwrite?: boolean;
        }
      | UpdateVariableArgs,
    accountName: string
  ): Promise<EnvironmentVariableFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateEnvironmentVariableForAccountMutation>(
          gql`
            mutation CreateEnvironmentVariableForAccount(
              $input: CreateSharedEnvironmentVariableInput!
              $accountName: String!
            ) {
              environmentVariable {
                createEnvironmentVariableForAccount(
                  environmentVariableData: $input
                  accountName: $accountName
                ) {
                  id
                  ...EnvironmentVariableFragment
                }
              }
            }
            ${print(EnvironmentVariableFragmentNode)}
          `,
          { input, accountName }
        )
        .toPromise()
    );

    return data.environmentVariable.createEnvironmentVariableForAccount;
  },
  async createForAppAsync(
    graphqlClient: ExpoGraphqlClient,
    input:
      | {
          name: string;
          value?: string;
          environment: string;
          visibility: EnvironmentVariableVisibility;
          overwrite?: boolean;
        }
      | (UpdateVariableArgs & { environment: string }),
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
    input: EnvironmentVariablePushInput[],
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
                createBulkEnvironmentVariablesForApp(
                  environmentVariablesData: $input
                  appId: $appId
                ) {
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
