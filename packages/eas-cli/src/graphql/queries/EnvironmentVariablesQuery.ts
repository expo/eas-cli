import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
  EnvironmentVariablesByAppIdQuery,
  EnvironmentVariablesSharedQuery,
  EnvironmentVariablesSharedQueryVariables,
} from '../generated';
import { EnvironmentVariableFragmentNode } from '../types/EnvironmentVariable';

type EnvironmentVariableWithLinkedEnvironments = EnvironmentVariableFragment & {
  linkedEnvironments?: EnvironmentVariableEnvironment[] | null;
};

export const EnvironmentVariablesQuery = {
  async byAppIdWithSensitiveAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      environment,
      filterNames,
    }: {
      appId: string;
      environment?: EnvironmentVariableEnvironment;
      filterNames?: string[];
    }
  ): Promise<EnvironmentVariableFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query(
          gql`
            query EnvironmentVariablesIncludingSensitiveByAppId(
              $appId: String!
              $filterNames: [String!]
              $environment: EnvironmentVariableEnvironment
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
          { additionalTypenames: ['EnvironmentVariableWithSecret'] }
        )
        .toPromise()
    );

    return data.app?.byId.environmentVariablesIncludingSensitive ?? [];
  },
  async byAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      environment,
      filterNames,
    }: {
      appId: string;
      environment?: EnvironmentVariableEnvironment;
      filterNames?: string[];
    }
  ): Promise<EnvironmentVariableWithLinkedEnvironments[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentVariablesByAppIdQuery>(
          gql`
            query EnvironmentVariablesByAppId(
              $appId: String!
              $filterNames: [String!]
              $environment: EnvironmentVariableEnvironment
            ) {
              app {
                byId(appId: $appId) {
                  id
                  environmentVariables(filterNames: $filterNames, environment: $environment) {
                    id
                    linkedEnvironments(appId: $appId)
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

    return data.app?.byId.environmentVariables ?? [];
  },
  async sharedAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      filterNames,
      environment,
    }: { appId: string; filterNames?: string[]; environment?: EnvironmentVariableEnvironment }
  ): Promise<EnvironmentVariableWithLinkedEnvironments[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentVariablesSharedQuery, EnvironmentVariablesSharedQueryVariables>(
          gql`
            query EnvironmentVariablesShared(
              $appId: String!
              $filterNames: [String!]
              $environment: EnvironmentVariableEnvironment
            ) {
              app {
                byId(appId: $appId) {
                  id
                  ownerAccount {
                    id
                    environmentVariables(filterNames: $filterNames, environment: $environment) {
                      id
                      linkedEnvironments(appId: $appId)
                      ...EnvironmentVariableFragment
                    }
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

    return data.app?.byId.ownerAccount.environmentVariables ?? [];
  },
  async sharedWithSensitiveAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      filterNames,
      environment,
    }: { appId: string; filterNames?: string[]; environment?: EnvironmentVariableEnvironment }
  ): Promise<EnvironmentVariableFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query(
          gql`
            query EnvironmentVariablesSharedWithSensitive(
              $appId: String!
              $filterNames: [String!]
              $environment: EnvironmentVariableEnvironment
            ) {
              app {
                byId(appId: $appId) {
                  id
                  ownerAccount {
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
            }
          `,
          { appId, filterNames, environment },
          { additionalTypenames: ['EnvironmentVariableWithSecret'] }
        )
        .toPromise()
    );

    return data.app?.byId.ownerAccount.environmentVariablesIncludingSensitive ?? [];
  },
};
