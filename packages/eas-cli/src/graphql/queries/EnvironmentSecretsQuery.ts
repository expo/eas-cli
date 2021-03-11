import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  EnvironmentSecretFragment,
  EnvironmentSecretsByAccountNameQuery,
  EnvironmentSecretsByAppFullNameQuery,
} from '../generated';
import { EnvironmentSecretFragmentNode } from '../types/EnvironmentSecret';

export const EnvironmentSecretsQuery = {
  async byAcccountNameAsync(accountName: string): Promise<EnvironmentSecretFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentSecretsByAccountNameQuery>(
          gql`
            query EnvironmentSecretsByAccountName($accountName: String!) {
              account {
                byName(accountName: $accountName) {
                  id
                  environmentSecrets {
                    ...EnvironmentSecretFragment
                  }
                }
              }
            }
            ${print(EnvironmentSecretFragmentNode)}
          `,
          { accountName }
        )
        .toPromise()
    );

    return data.account.byName.environmentSecrets;
  },
  async byAppFullNameAsync(fullName: string): Promise<EnvironmentSecretFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentSecretsByAppFullNameQuery>(
          gql`
            query EnvironmentSecretsByAppFullName($fullName: String!) {
              app {
                byFullName(fullName: $fullName) {
                  id
                  environmentSecrets {
                    ...EnvironmentSecretFragment
                  }
                }
              }
            }
            ${print(EnvironmentSecretFragmentNode)}
          `,
          { fullName }
        )
        .toPromise()
    );

    return data.app?.byFullName.environmentSecrets ?? [];
  },
};
