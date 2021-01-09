import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { AppPlatform, Build } from '../generated';

type Filters = Partial<Pick<Build, 'platform' | 'status'>> & {
  offset?: number;
  limit?: number;
};

type BuildQueryResult = Pick<Build, 'platform' | 'artifacts'>;
type PendingBuildQueryResult = Pick<Build, 'id' | 'platform'>;

const BuildQuery = {
  async byIdAsync(buildId: string): Promise<BuildQueryResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ builds: { byId: BuildQueryResult } }>(
          gql`
            query BuildsByIdQuery($buildId: ID!) {
              builds {
                byId(buildId: $buildId) {
                  id
                  platform
                  artifacts {
                    buildUrl
                  }
                }
              }
            }
          `,
          { buildId }
        )
        .toPromise()
    );

    return data.builds.byId;
  },
  async allForAppAsync(appId: string, filters?: Filters): Promise<BuildQueryResult[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ builds: { allForApp: BuildQueryResult[] } }>(
          // TODO: Change $appId: String! to ID! when fixed server-side schema
          gql`
            query BuildsForAppQuery(
              $appId: String!
              $limit: Int
              $offset: Int
              $platform: AppPlatform
              $status: BuildStatus
            ) {
              builds {
                allForApp(
                  appId: $appId
                  limit: $limit
                  offset: $offset
                  platform: $platform
                  status: $status
                ) {
                  id
                  platform
                  artifacts {
                    buildUrl
                  }
                }
              }
            }
          `,
          { ...filters, appId }
        )
        .toPromise()
    );

    return data.builds.allForApp;
  },

  async getPendingBuildIdAsync(
    accountName: string,
    platform: AppPlatform
  ): Promise<PendingBuildQueryResult | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{
          account: {
            byName: {
              inQueueBuilds: PendingBuildQueryResult[];
              inProgressBuilds: PendingBuildQueryResult[];
            };
          };
        }>(
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

export { BuildQuery };
