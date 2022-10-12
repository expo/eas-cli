import assert from 'assert';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { AppPrivacy, CreateAppMutation, CreateAppMutationVariables } from '../generated';

export const AppMutation = {
  async createAppAsync(
    graphqlClient: ExpoGraphqlClient,
    appInput: {
      accountId: string;
      projectName: string;
      privacy: AppPrivacy;
    }
  ): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAppMutation, CreateAppMutationVariables>(
          gql`
            mutation CreateAppMutation($appInput: AppInput!) {
              app {
                createApp(appInput: $appInput) {
                  id
                }
              }
            }
          `,
          {
            appInput,
          }
        )
        .toPromise()
    );
    const appId = data.app?.createApp.id;
    assert(appId, 'App ID must be defined');
    return appId;
  },
};
