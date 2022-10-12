import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateEnvironmentSecretForAccountMutation,
  CreateEnvironmentSecretForAppMutation,
  DeleteEnvironmentSecretMutation,
  EnvironmentSecretFragment,
  EnvironmentSecretType,
} from '../generated';
import { EnvironmentSecretFragmentNode } from '../types/EnvironmentSecret';

export const EnvironmentSecretMutation = {
  async createForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    input: { name: string; value: string; type: EnvironmentSecretType },
    accountId: string
  ): Promise<EnvironmentSecretFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateEnvironmentSecretForAccountMutation>(
          gql`
            mutation CreateEnvironmentSecretForAccount(
              $input: CreateEnvironmentSecretInput!
              $accountId: String!
            ) {
              environmentSecret {
                createEnvironmentSecretForAccount(
                  environmentSecretData: $input
                  accountId: $accountId
                ) {
                  id
                  ...EnvironmentSecretFragment
                }
              }
            }
            ${print(EnvironmentSecretFragmentNode)}
          `,
          { input, accountId }
        )
        .toPromise()
    );

    return data.environmentSecret.createEnvironmentSecretForAccount;
  },
  async createForAppAsync(
    graphqlClient: ExpoGraphqlClient,
    input: { name: string; value: string; type: EnvironmentSecretType },
    appId: string
  ): Promise<EnvironmentSecretFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateEnvironmentSecretForAppMutation>(
          gql`
            mutation CreateEnvironmentSecretForApp(
              $input: CreateEnvironmentSecretInput!
              $appId: String!
            ) {
              environmentSecret {
                createEnvironmentSecretForApp(environmentSecretData: $input, appId: $appId) {
                  id
                  ...EnvironmentSecretFragment
                }
              }
            }
            ${print(EnvironmentSecretFragmentNode)}
          `,
          { input, appId }
        )
        .toPromise()
    );

    return data.environmentSecret.createEnvironmentSecretForApp;
  },
  async deleteAsync(graphqlClient: ExpoGraphqlClient, id: string): Promise<{ id: string }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteEnvironmentSecretMutation>(
          gql`
            mutation DeleteEnvironmentSecret($id: String!) {
              environmentSecret {
                deleteEnvironmentSecret(id: $id) {
                  id
                }
              }
            }
          `,
          { id }
        )
        .toPromise()
    );

    return data.environmentSecret.deleteEnvironmentSecret;
  },
};
