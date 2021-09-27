import assert from 'assert';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { AppPrivacy, CreateAppMutation, CreateAppMutationVariables } from '../generated';

export const AppMutation = {
  async createAppAsync(appInput: {
    accountId: string;
    projectName: string;
    privacy: AppPrivacy;
  }): Promise<string> {
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
