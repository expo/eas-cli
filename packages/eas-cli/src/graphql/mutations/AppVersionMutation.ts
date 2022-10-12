import assert from 'assert';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppPlatform,
  CreateAppVersionMutation,
  CreateAppVersionMutationVariables,
} from '../generated';

export const AppVersionMutation = {
  async createAppVersionAsync(
    graphqlClient: ExpoGraphqlClient,
    appVersionInput: {
      appId: string;
      platform: AppPlatform;
      applicationIdentifier: string;
      storeVersion: string;
      buildVersion: string;
      runtimeVersion?: string;
    }
  ): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAppVersionMutation, CreateAppVersionMutationVariables>(
          gql`
            mutation CreateAppVersionMutation($appVersionInput: AppVersionInput!) {
              appVersion {
                createAppVersion(appVersionInput: $appVersionInput) {
                  id
                }
              }
            }
          `,
          {
            appVersionInput,
          }
        )
        .toPromise()
    );
    const appVersionId = data.appVersion?.createAppVersion.id;
    assert(appVersionId, 'AppVersion ID must be defined');
    return appVersionId;
  },
};
