import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
  EnvironmentVariablesByAppIdQuery,
} from '../generated';
import { EnvironmentVariableFragmentNode } from '../types/EnvironmentVariable';

export const EnvironmentVariablesQuery = {
  async byAppIdWithSensitiveAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      environment,
      filterNames,
    }: {
      appId: string;
      environment: EnvironmentVariableEnvironment;
      filterNames?: string[];
    }
  ): Promise<{
    appVariables: EnvironmentVariableFragment[];
  }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query(
          gql`
            query EnvironmentVariablesIncludingSensitiveByAppId(
              $appId: String!
              $filterNames: [String!]
              $environment: EnvironmentVariableEnvironment!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  environmentVariablesIncludingSensitive(
                    filterNames: $filterNames
                    environment: $environment
                  ) {
                    id
                    name
                    value
                  }
                }
              }
            }
          `,
          { appId, filterNames, environment },
          { additionalTypenames: ['EnvironmentVariable'] }
        )
        .toPromise()
    );

    return {
      appVariables: data.app?.byId.environmentVariablesIncludingSensitive ?? [],
    };
  },
  async byAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    environment: string,
    filterNames?: string[]
  ): Promise<{
    sharedVariables: EnvironmentVariableFragment[];
    appVariables: EnvironmentVariableFragment[];
  }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentVariablesByAppIdQuery>(
          gql`
            query EnvironmentVariablesByAppId(
              $appId: String!
              $filterNames: [String!]
              $environment: EnvironmentVariableEnvironment!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  ownerAccount {
                    id
                    environmentVariables(filterNames: $filterNames) {
                      id
                      ...EnvironmentVariableFragment
                    }
                  }
                  environmentVariables(filterNames: $filterNames, environment: $environment) {
                    id
                    ...EnvironmentVariableFragment
                  }
                }
              }
            }
            ${print(EnvironmentVariableFragmentNode)}
          `,
          { appId, filterNames, environment },
          { additionalTypenames: ['EnvironmentVariable'] }
        )
        .toPromise()
    );

    return {
      sharedVariables: data.app?.byId.ownerAccount.environmentVariables ?? [],
      appVariables: data.app?.byId.environmentVariables ?? [],
    };
  },
  async sharedAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    filterNames?: string[]
  ): Promise<EnvironmentVariableFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentVariablesByAppIdQuery>(
          gql`
            query EnvironmentVariablesShared($appId: String!, $filterNames: [String!]) {
              app {
                byId(appId: $appId) {
                  id
                  ownerAccount {
                    id
                    environmentVariables(filterNames: $filterNames) {
                      id
                      ...EnvironmentVariableFragment
                    }
                  }
                }
              }
            }
            ${print(EnvironmentVariableFragmentNode)}
          `,
          { appId, filterNames },
          { additionalTypenames: ['EnvironmentVariable'] }
        )
        .toPromise()
    );

    return data.app?.byId.ownerAccount.environmentVariables ?? [];
  },
};
