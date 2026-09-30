import assert from 'assert';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  BackgroundJobReceiptDataFragment,
  CreateAppMutation,
  CreateAppMutationVariables,
  ScheduleAppDeletionMutation,
  ScheduleAppDeletionMutationVariables,
} from '../generated';
import { BackgroundJobReceiptNode } from '../types/BackgroundJobReceipt';

export const AppMutation = {
  async createAppAsync(
    graphqlClient: ExpoGraphqlClient,
    appInput: {
      accountId: string;
      projectName: string;
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
  async scheduleAppDeletionAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string
  ): Promise<BackgroundJobReceiptDataFragment> {
    const result = await withErrorHandlingAsync(
      graphqlClient
        .mutation<ScheduleAppDeletionMutation, ScheduleAppDeletionMutationVariables>(
          gql`
            mutation ScheduleAppDeletion($appId: ID!) {
              app {
                scheduleAppDeletion(appId: $appId) {
                  id
                  ...BackgroundJobReceiptData
                }
              }
            }
            ${BackgroundJobReceiptNode}
          `,
          { appId }
        )
        .toPromise()
    );
    const receipt = result.app?.scheduleAppDeletion;
    assert(receipt, 'Background job receipt must be defined');
    return receipt;
  },
};
