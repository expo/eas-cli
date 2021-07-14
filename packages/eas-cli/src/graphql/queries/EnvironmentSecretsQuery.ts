import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  EnvironmentSecretFragment,
  EnvironmentSecretsByAccountNameQuery,
  EnvironmentSecretsByAppIdQuery,
} from '../generated';
import { EnvironmentSecretFragmentNode } from '../types/EnvironmentSecret';

export enum EnvironmentSecretScope {
  ACCOUNT = 'account',
  PROJECT = 'project',
}

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
  async byAppIdAsync(appId: string): Promise<EnvironmentSecretFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentSecretsByAppIdQuery>(
          gql`
            query EnvironmentSecretsByAppId($appId: String!) {
              app {
                byId(appId: $appId) {
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
          { appId }
        )
        .toPromise()
    );

    return data.app?.byId.environmentSecrets ?? [];
  },
  async allAsync(
    projectAccountName: string,
    projectFullName: string
  ): Promise<EnvironmentSecretWithScope[]> {
    const [accountSecrets, appSecrets] = await Promise.all([
      this.byAcccountNameAsync(projectAccountName),
      this.byAppIdAsync(projectFullName),
    ]);

    return [
      ...appSecrets.map(s => ({ ...s, scope: EnvironmentSecretScope.PROJECT })),
      ...accountSecrets.map(s => ({ ...s, scope: EnvironmentSecretScope.ACCOUNT })),
    ];
  },
};
