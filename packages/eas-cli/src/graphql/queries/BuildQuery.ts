import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { Build } from '../types/Build';

type Filters = Partial<Pick<Build, 'platform' | 'status'>> & {
  offset?: number;
  limit?: number;
};

type BuildQueryResult = Pick<Build, 'platform' | 'artifacts'>;

export class BuildQuery {
  static async byIdAsync(buildId: string): Promise<BuildQueryResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ builds: { byId: BuildQueryResult } }>(
          gql`
            query($buildId: ID!) {
              builds {
                byId(buildId: $buildId) {
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
  }

  static async allForAppAsync(appId: string, filters?: Filters): Promise<BuildQueryResult[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ builds: { allForApp: BuildQueryResult[] } }>(
          // TODO: Change $appId: String! to ID! when fixed server-side schema
          gql`
            query(
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
  }
}
