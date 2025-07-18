import { print } from 'graphql';
import gql from 'graphql-tag';

import { WorkerDeploymentFragmentNode } from './fragments/WorkerDeployment';
import { WorkerDeploymentAliasFragmentNode } from './fragments/WorkerDeploymentAlias';
import type { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../graphql/client';
import {
  type PaginatedWorkerDeploymentsQuery,
  type PaginatedWorkerDeploymentsQueryVariables,
  SuggestedDevDomainNameQuery,
  SuggestedDevDomainNameQueryVariables,
  type WorkerDeploymentAliasFragment,
  type WorkerDeploymentFragment,
} from '../graphql/generated';
import type { Connection } from '../utils/relay';

export const DeploymentsQuery = {
  async getAllDeploymentsPaginatedAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId, first, after, last, before }: PaginatedWorkerDeploymentsQueryVariables
  ): Promise<Connection<WorkerDeploymentFragment>> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<PaginatedWorkerDeploymentsQuery, PaginatedWorkerDeploymentsQueryVariables>(
          gql`
            query PaginatedWorkerDeployments(
              $appId: String!
              $first: Int
              $after: String
              $last: Int
              $before: String
            ) {
              app {
                byId(appId: $appId) {
                  id
                  workerDeployments(first: $first, after: $after, last: $last, before: $before) {
                    pageInfo {
                      hasNextPage
                      hasPreviousPage
                      startCursor
                      endCursor
                    }
                    edges {
                      cursor
                      node {
                        id
                        ...WorkerDeploymentFragment
                      }
                    }
                  }
                }
              }
            }
            ${print(WorkerDeploymentFragmentNode)}
          `,
          { appId, first, after, last, before },
          { additionalTypenames: ['WorkerDeployment'] }
        )
        .toPromise()
    );

    return data.app.byId.workerDeployments;
  },

  async getSuggestedDevDomainByAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    { appId }: SuggestedDevDomainNameQueryVariables
  ): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<SuggestedDevDomainNameQuery, SuggestedDevDomainNameQueryVariables>(
          gql`
            query SuggestedDevDomainName($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  suggestedDevDomainName
                }
              }
            }
          `,
          { appId },
          { additionalTypenames: ['App'] }
        )
        .toPromise()
    );

    return data.app.byId.suggestedDevDomainName;
  },

  async getAllAliasesPaginatedAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      first,
      after,
      last,
      before,
    }: {
      appId: string;
      first?: number;
      after?: string;
      last?: number;
      before?: string;
    }
  ): Promise<Connection<WorkerDeploymentAliasFragment>> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query(
          gql`
            query PaginatedWorkerDeploymentAliases(
              $appId: String!
              $first: Int
              $after: String
              $last: Int
              $before: String
            ) {
              app {
                byId(appId: $appId) {
                  id
                  workerDeploymentAliases(
                    first: $first
                    after: $after
                    last: $last
                    before: $before
                  ) {
                    pageInfo {
                      hasNextPage
                      hasPreviousPage
                      startCursor
                      endCursor
                    }
                    edges {
                      cursor
                      node {
                        id
                        ...WorkerDeploymentAliasFragment
                      }
                    }
                  }
                }
              }
            }
            ${print(WorkerDeploymentAliasFragmentNode)}
          `,
          { appId, first, after, last, before },
          { additionalTypenames: ['WorkerDeploymentAlias'] }
        )
        .toPromise()
    );

    return data.app.byId.workerDeploymentAliases;
  },
};
