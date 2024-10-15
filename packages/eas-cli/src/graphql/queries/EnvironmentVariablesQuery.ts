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
import { EnvironmentVariableWithSecretFragmentNode } from '../types/EnvironmentVariableWithSecret';

type EnvironmentVariableWithLinkedEnvironments = EnvironmentVariableFragment & {
  linkedEnvironments?: EnvironmentVariableEnvironment[] | null;
};

export type EnvironmentVariableWithFileContent = EnvironmentVariableFragment & {
  valueWithFileContent?: string | null | undefined;
};

export const EnvironmentVariablesQuery = {
  async byAppIdWithSensitiveAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      environment,
      filterNames,
      includeFileContent = false,
    }: {
      appId: string;
      environment?: EnvironmentVariableEnvironment;
      filterNames?: string[];
      includeFileContent?: boolean;
    }
  ): Promise<EnvironmentVariableWithFileContent[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query(
          gql`
            query EnvironmentVariablesIncludingSensitiveByAppId(
              $appId: String!
              $filterNames: [String!]
              $environment: EnvironmentVariableEnvironment
              $includeFileContent: Boolean!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  environmentVariablesIncludingSensitive(
                    filterNames: $filterNames
                    environment: $environment
                  ) {
                    id
                    ...EnvironmentVariableWithSecretFragment
                    valueWithFileContent: value(includeFileContent: $includeFileContent)
                      @include(if: $includeFileContent)
                  }
                }
              }
            }
            ${print(EnvironmentVariableWithSecretFragmentNode)}
          `,
          { appId, filterNames, environment, includeFileContent },
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
      includeFileContent = false,
    }: {
      appId: string;
      environment?: EnvironmentVariableEnvironment;
      filterNames?: string[];
      includeFileContent?: boolean;
    }
  ): Promise<(EnvironmentVariableWithFileContent & EnvironmentVariableWithLinkedEnvironments)[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentVariablesByAppIdQuery>(
          gql`
            query EnvironmentVariablesByAppId(
              $appId: String!
              $filterNames: [String!]
              $environment: EnvironmentVariableEnvironment
              $includeFileContent: Boolean!
            ) {
              app {
                byId(appId: $appId) {
                  id
                  environmentVariables(filterNames: $filterNames, environment: $environment) {
                    id
                    linkedEnvironments(appId: $appId)
                    ...EnvironmentVariableFragment
                    valueWithFileContent: value(includeFileContent: $includeFileContent)
                      @include(if: $includeFileContent)
                  }
                }
              }
            }
            ${print(EnvironmentVariableFragmentNode)}
          `,
          { appId, filterNames, environment, includeFileContent },
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
      includeFileContent = false,
    }: {
      appId: string;
      filterNames?: string[];
      environment?: EnvironmentVariableEnvironment;
      includeFileContent?: boolean;
    }
  ): Promise<(EnvironmentVariableWithFileContent & EnvironmentVariableWithLinkedEnvironments)[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<EnvironmentVariablesSharedQuery, EnvironmentVariablesSharedQueryVariables>(
          gql`
            query EnvironmentVariablesShared(
              $appId: String!
              $filterNames: [String!]
              $environment: EnvironmentVariableEnvironment
              $includeFileContent: Boolean!
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
                      valueWithFileContent: value(includeFileContent: $includeFileContent)
                        @include(if: $includeFileContent)
                    }
                  }
                }
              }
            }
            ${print(EnvironmentVariableFragmentNode)}
          `,
          { appId, filterNames, environment, includeFileContent },
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
      includeFileContent = false,
    }: {
      appId: string;
      filterNames?: string[];
      environment?: EnvironmentVariableEnvironment;
      includeFileContent?: boolean;
    }
  ): Promise<EnvironmentVariableWithFileContent[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query(
          gql`
            query EnvironmentVariablesSharedWithSensitive(
              $appId: String!
              $filterNames: [String!]
              $environment: EnvironmentVariableEnvironment
              $includeFileContent: Boolean!
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
                      ...EnvironmentVariableWithSecretFragment
                      valueWithFileContent: value(includeFileContent: $includeFileContent)
                        @include(if: $includeFileContent)
                    }
                  }
                }
              }
            }
            ${print(EnvironmentVariableWithSecretFragmentNode)}
          `,
          { appId, filterNames, environment, includeFileContent },
          { additionalTypenames: ['EnvironmentVariableWithSecret'] }
        )
        .toPromise()
    );

    return data.app?.byId.ownerAccount.environmentVariablesIncludingSensitive ?? [];
  },
};
