import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  BuildsByIdQuery,
  BuildsByIdQueryVariables,
  DistributionType,
  GetAllBuildsForAppQuery,
  GetAllBuildsForAppQueryVariables,
} from '../generated';
import { BuildFragmentNode } from '../types/Build';

type BuildsQuery = {
  offset?: number;
  limit?: number;
  filter?: {
    platform?: AppPlatform;
    status?: BuildStatus;
    distribution?: DistributionType;
    channel?: string;
    appVersion?: string;
    appBuildVersion?: string;
    sdkVersion?: string;
    runtimeVersion?: string;
    appIdentifier?: string;
    buildProfile?: string;
    gitCommitHash?: string;
  };
};

export const BuildQuery = {
  async byIdAsync(
    buildId: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<BuildFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<BuildsByIdQuery, BuildsByIdQueryVariables>(
          gql`
            query BuildsByIdQuery($buildId: ID!) {
              builds {
                byId(buildId: $buildId) {
                  id
                  ...BuildFragment
                }
              }
            }
            ${print(BuildFragmentNode)}
          `,
          { buildId },
          {
            requestPolicy: useCache ? 'cache-first' : 'network-only',
          }
        )
        .toPromise()
    );

    return data.builds.byId;
  },

  async allForAppAsync(
    appId: string,
    { limit = 10, offset = 0, filter }: BuildsQuery
  ): Promise<BuildFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GetAllBuildsForAppQuery, GetAllBuildsForAppQueryVariables>(
          // TODO: Change $appId: String! to ID! when fixed server-side schema
          gql`
            query GetAllBuildsForApp(
              $appId: String!
              $offset: Int!
              $limit: Int!
              $filter: BuildFilter
            ) {
              app {
                byId(appId: $appId) {
                  id
                  builds(offset: $offset, limit: $limit, filter: $filter) {
                    id
                    ...BuildFragment
                  }
                }
              }
            }
            ${print(BuildFragmentNode)}
          `,
          { appId, offset, limit, filter },
          {
            additionalTypenames: ['Build'],
          }
        )
        .toPromise()
    );

    return data.app?.byId.builds ?? [];
  },
};
