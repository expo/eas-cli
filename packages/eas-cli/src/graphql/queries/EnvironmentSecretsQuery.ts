import { print } from 'graphql';
import gql from 'graphql-tag';

import { EnvironmentSecretScope } from '../../commands/secrets/create';
import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  EnvironmentSecretFragment,
  EnvironmentSecretsByAccountNameQuery,
  EnvironmentSecretsByAppFullNameQuery,
} from '../generated';
import { EnvironmentSecretFragmentNode } from '../types/EnvironmentSecret';

export type EnvironmentSecretWithScope = EnvironmentSecretFragment & {
  scope: EnvironmentSecretScope;
};

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
                    id
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
                    id
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
  async allAsync(
    projectAccountName: string,
    projectFullName: string
  ): Promise<EnvironmentSecretWithScope[]> {
    const [accountSecrets, appSecrets] = await Promise.all([
      this.byAcccountNameAsync(projectAccountName),
      this.byAppFullNameAsync(projectFullName),
    ]);

    return [
      ...appSecrets.map(s => ({ ...s, scope: EnvironmentSecretScope.PROJECT })),
      ...accountSecrets.map(s => ({ ...s, scope: EnvironmentSecretScope.ACCOUNT })),
    ];
  },
};
