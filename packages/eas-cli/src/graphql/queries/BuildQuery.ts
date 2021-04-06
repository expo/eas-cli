import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  AppPlatform,
  Build,
  BuildFragment,
  BuildStatus,
  BuildsByIdQuery,
  BuildsByIdQueryVariables,
  GetAllBuildsForAppQuery,
  GetAllBuildsForAppQueryVariables,
  PendingBuildsForAccountAndPlatformQuery,
  PendingBuildsForAccountAndPlatformQueryVariables,
} from '../generated';
import { BuildFragmentNode } from '../types/Build';

type Filters = {
  platform?: AppPlatform;
  status?: BuildStatus;
  offset?: number;
  limit?: number;
};

type PendingBuildQueryResult = Pick<Build, 'id' | 'platform'>;

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
    { limit = 10, offset = 0, status, platform }: Filters
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
              $status: BuildStatus
              $platform: AppPlatform
            ) {
              app {
                byId(appId: $appId) {
                  id
                  builds(offset: $offset, limit: $limit, status: $status, platform: $platform) {
                    id
                    ...BuildFragment
                  }
                }
              }
            }
            ${print(BuildFragmentNode)}
          `,
          { appId, offset, limit, status, platform }
        )
        .toPromise()
    );

    return data.app?.byId.builds ?? [];
  },

  async getPendingBuildIdAsync(
    accountName: string,
    platform: AppPlatform
  ): Promise<PendingBuildQueryResult | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<
          PendingBuildsForAccountAndPlatformQuery,
          PendingBuildsForAccountAndPlatformQueryVariables
        >(
          gql`
            query PendingBuildsForAccountAndPlatform(
              $accountName: String!
              $platform: AppPlatform!
            ) {
              account {
                byName(accountName: $accountName) {
                  id
                  inQueueBuilds: builds(
                    offset: 0
                    limit: 1
                    platform: $platform
                    status: IN_QUEUE
                  ) {
                    id
                    platform
                  }
                  inProgressBuilds: builds(
                    offset: 0
                    limit: 1
                    platform: $platform
                    status: IN_PROGRESS
                  ) {
                    id
                    platform
                  }
                }
              }
            }
          `,
          { accountName, platform }
        )
        .toPromise()
    );
    const pendingBuilds = [
      ...data.account.byName.inProgressBuilds,
      ...data.account.byName.inQueueBuilds,
    ];
    return pendingBuilds.length > 0 ? pendingBuilds[0] : null;
  },
};
