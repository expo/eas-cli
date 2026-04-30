import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';

export const AscAppLinkMutation = {
  async createAppStoreConnectAppAsync(
    graphqlClient: ExpoGraphqlClient,
    appStoreConnectAppInput: {
      appId: string;
      ascAppIdentifier: string;
      appStoreConnectApiKeyId: string;
    }
  ): Promise<{ id: string; ascAppIdentifier: string }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{
          appStoreConnectApp: {
            createAppStoreConnectApp: {
              id: string;
              ascAppIdentifier: string;
            };
          };
        }>(
          gql`
            mutation CreateAppStoreConnectApp($appStoreConnectAppInput: AppStoreConnectAppInput!) {
              appStoreConnectApp {
                createAppStoreConnectApp(appStoreConnectAppInput: $appStoreConnectAppInput) {
                  id
                  ascAppIdentifier
                }
              }
            }
          `,
          { appStoreConnectAppInput }
        )
        .toPromise()
    );

    return data.appStoreConnectApp.createAppStoreConnectApp;
  },

  async deleteAppStoreConnectAppAsync(
    graphqlClient: ExpoGraphqlClient,
    appStoreConnectAppId: string
  ): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<{
          appStoreConnectApp: {
            deleteAppStoreConnectApp: {
              id: string;
            };
          };
        }>(
          gql`
            mutation DeleteAppStoreConnectApp($appStoreConnectAppId: ID!) {
              appStoreConnectApp {
                deleteAppStoreConnectApp(appStoreConnectAppId: $appStoreConnectAppId) {
                  id
                }
              }
            }
          `,
          { appStoreConnectAppId }
        )
        .toPromise()
    );
  },
};
