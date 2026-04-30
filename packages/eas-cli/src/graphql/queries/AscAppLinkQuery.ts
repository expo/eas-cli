import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AscAppLinkAppMetadataQuery,
  AscAppLinkAppMetadataQueryVariables,
  DiscoverAccessibleAppStoreConnectAppsQuery,
  DiscoverAccessibleAppStoreConnectAppsQueryVariables,
} from '../generated';
import { AccountFragmentNode } from '../types/Account';

export const AscAppLinkQuery = {
  async getAppMetadataAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    options?: {
      useCache?: boolean;
    }
  ): Promise<AscAppLinkAppMetadataQuery['app']['byId']> {
    const useCache = options?.useCache ?? true;
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AscAppLinkAppMetadataQuery, AscAppLinkAppMetadataQueryVariables>(
          gql`
            query AscAppLinkAppMetadata($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  fullName
                  ownerAccount {
                    id
                    ...AccountFragment
                  }
                  appStoreConnectApp {
                    id
                    ascAppIdentifier
                    remoteAppStoreConnectApp {
                      ascAppIdentifier
                      bundleIdentifier
                      name
                      appStoreIconUrl
                    }
                  }
                }
              }
            }
            ${print(AccountFragmentNode)}
          `,
          { appId },
          {
            requestPolicy: useCache ? 'cache-first' : 'network-only',
            additionalTypenames: ['App', 'AppStoreConnectApp'],
          }
        )
        .toPromise()
    );

    return data.app.byId;
  },

  async discoverAccessibleAppsAsync(
    graphqlClient: ExpoGraphqlClient,
    appStoreConnectApiKeyId: string,
    bundleIdentifier?: string
  ): Promise<
    DiscoverAccessibleAppStoreConnectAppsQuery['appStoreConnectApiKey']['byId']['remoteAppStoreConnectApps']
  > {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<
          DiscoverAccessibleAppStoreConnectAppsQuery,
          DiscoverAccessibleAppStoreConnectAppsQueryVariables
        >(
          gql`
            query DiscoverAccessibleAppStoreConnectApps(
              $appStoreConnectApiKeyId: ID!
              $bundleIdentifier: String
            ) {
              appStoreConnectApiKey {
                byId(id: $appStoreConnectApiKeyId) {
                  id
                  remoteAppStoreConnectApps(bundleIdentifier: $bundleIdentifier) {
                    ascAppIdentifier
                    bundleIdentifier
                    name
                    appStoreIconUrl
                  }
                }
              }
            }
          `,
          { appStoreConnectApiKeyId, bundleIdentifier },
          { additionalTypenames: ['AppStoreConnectApp'] }
        )
        .toPromise()
    );

    return data.appStoreConnectApiKey.byId?.remoteAppStoreConnectApps ?? [];
  },
};
