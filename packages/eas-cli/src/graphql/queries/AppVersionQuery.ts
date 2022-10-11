import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppPlatform,
  AppVersion,
  LatestAppVersionQuery,
  LatestAppVersionQueryVariables,
} from '../generated';

export const AppVersionQuery = {
  async latestVersionAsync(
    graphqlClient: ExpoGraphqlClient,
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
                  id
                  latestAppVersionByPlatformAndApplicationIdentifier(
                    platform: $platform
                    applicationIdentifier: $applicationIdentifier
                  ) {
                    id
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
