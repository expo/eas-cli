import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { EnvironmentSecretFragment, EnvironmentSecretsByAppIdQuery } from '../generated';
import { EnvironmentSecretFragmentNode } from '../types/EnvironmentSecret';

export enum EnvironmentSecretScope {
  ACCOUNT = 'account',
  PROJECT = 'project',
}

export type EnvironmentSecretWithScope = EnvironmentSecretFragment & {
  scope: EnvironmentSecretScope;
};

export const EnvironmentSecretsQuery = {
  async byAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    filterNames?: string[]
  ): Promise<{
    accountSecrets: EnvironmentSecretFragment[];
    appSecrets: EnvironmentSecretFragment[];
  }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentSecretsByAppIdQuery>(
          gql`
            query EnvironmentSecretsByAppId($appId: String!, $filterNames: [String!]) {
              app {
                byId(appId: $appId) {
                  id
                  ownerAccount {
                    id
                    environmentSecrets(filterNames: $filterNames) {
                      id
                      ...EnvironmentSecretFragment
                    }
                  }
                  environmentSecrets(filterNames: $filterNames) {
                    id
                    ...EnvironmentSecretFragment
                  }
                }
              }
            }
            ${print(EnvironmentSecretFragmentNode)}
          `,
          { appId, filterNames },
          { additionalTypenames: ['EnvironmentSecret'] }
        )
        .toPromise()
    );

    return {
      accountSecrets: data.app?.byId.ownerAccount.environmentSecrets ?? [],
      appSecrets: data.app?.byId.environmentSecrets ?? [],
    };
  },
  async allAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string
  ): Promise<EnvironmentSecretWithScope[]> {
    const { accountSecrets, appSecrets } = await this.byAppIdAsync(graphqlClient, projectId);
    return [
      ...appSecrets.map(s => ({ ...s, scope: EnvironmentSecretScope.PROJECT })),
      ...accountSecrets.map(s => ({ ...s, scope: EnvironmentSecretScope.ACCOUNT })),
    ];
  },
};
