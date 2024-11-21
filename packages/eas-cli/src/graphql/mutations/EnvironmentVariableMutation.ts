import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateBulkEnvironmentVariablesForAppMutation,
  CreateEnvironmentVariableForAccountMutation,
  CreateEnvironmentVariableForAppMutation,
  DeleteEnvironmentVariableMutation,
  EnvironmentSecretType,
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
  EnvironmentVariableVisibility,
  LinkSharedEnvironmentVariableMutation,
  UnlinkSharedEnvironmentVariableMutation,
  UpdateEnvironmentVariableMutation,
} from '../generated';
import { EnvironmentVariableFragmentNode } from '../types/EnvironmentVariable';

type CreateVariableArgs = {
  value: string;
  name: string;
  visibility: EnvironmentVariableVisibility;
  environments: EnvironmentVariableEnvironment[];
  type: EnvironmentSecretType;
  isGlobal?: boolean;
  fileName?: string;
};

export type EnvironmentVariablePushInput = {
  name: string;
  value: string;
  environments: EnvironmentVariableEnvironment[];
  visibility: EnvironmentVariableVisibility;
  overwrite?: boolean;
};

export const EnvironmentVariableMutation = {
  async linkSharedEnvironmentVariableAsync(
    graphqlClient: ExpoGraphqlClient,
    environmentVariableId: string,
    appId: string,
    environment?: EnvironmentVariableEnvironment
  ): Promise<EnvironmentVariableFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<LinkSharedEnvironmentVariableMutation>(
          gql`
            mutation LinkSharedEnvironmentVariable(
              $appId: ID!
              $environment: EnvironmentVariableEnvironment
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
    environment?: EnvironmentVariableEnvironment
  ): Promise<EnvironmentVariableFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UnlinkSharedEnvironmentVariableMutation>(
          gql`
            mutation UnlinkSharedEnvironmentVariable(
              $appId: ID!
              $environment: EnvironmentVariableEnvironment
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
    input: CreateVariableArgs,
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
    input: CreateVariableArgs,
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
    input: Partial<CreateVariableArgs> & { id: string }
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
