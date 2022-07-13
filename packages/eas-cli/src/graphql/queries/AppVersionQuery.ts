import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  AppPlatform,
  AppVersion,
  LatestAppVersionQuery,
  LatestAppVersionQueryVariables,
} from '../generated';

export const AppVersionQuery = {
  async latestVersionAsync(
    appId: string,
    platform: AppPlatform,
    applicationIdentifier: string
  ): Promise<Pick<AppVersion, 'storeVersion' | 'buildVersion'> | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<LatestAppVersionQuery, LatestAppVersionQueryVariables>(
          gql`
            query LatestAppVersion(
              $appId: String!
              $platform: AppPlatform!
              $applicationIdentifier: String!
            ) {
              app {
                byId(appId: $appId) {
                  latestAppVersionByPlatformAndApplicationIdentifier(
                    platform: $platform
                    applicationIdentifier: $applicationIdentifier
                  ) {
                    storeVersion
                    buildVersion
                  }
                }
              }
            }
          `,
          { appId, applicationIdentifier, platform },
          {
            additionalTypenames: ['App', 'AppVersion'],
          }
        )
        .toPromise()
    );

    return data.app.byId.latestAppVersionByPlatformAndApplicationIdentifier ?? null;
  },
};
