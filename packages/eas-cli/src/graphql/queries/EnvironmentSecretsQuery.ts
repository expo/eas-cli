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
    appId: string
  ): Promise<{
    accountSecrets: EnvironmentSecretFragment[];
    appSecrets: EnvironmentSecretFragment[];
  }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentSecretsByAppIdQuery>(
          gql`
            query EnvironmentSecretsByAppId($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  ownerAccount {
                    id
                    environmentSecrets {
                      id
                      ...EnvironmentSecretFragment
                    }
                  }
                  environmentSecrets {
                    id
                    ...EnvironmentSecretFragment
                  }
                }
              }
            }
            ${print(EnvironmentSecretFragmentNode)}
          `,
          { appId },
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
