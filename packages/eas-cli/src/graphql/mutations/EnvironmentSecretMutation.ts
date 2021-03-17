import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  CreateEnvironmentSecretForAccountMutation,
  CreateEnvironmentSecretForAppMutation,
  DeleteEnvironmentSecretMutation,
  EnvironmentSecretFragment,
} from '../generated';
import { EnvironmentSecretFragmentNode } from '../types/EnvironmentSecret';

export const EnvironmentSecretMutation = {
  async createForAccount(
    input: { name: string; value: string },
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
  async createForApp(
    input: { name: string; value: string },
    appId: string
  ): Promise<EnvironmentSecretFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<CreateEnvironmentSecretForAppMutation>(
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
  async delete(id: string): Promise<{ id: string }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<DeleteEnvironmentSecretMutation>(
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
