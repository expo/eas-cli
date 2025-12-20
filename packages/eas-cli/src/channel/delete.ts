import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../graphql/client';
import {
  BackgroundJobReceiptDataFragment,
  ScheduleChannelDeletionMutation,
  ScheduleChannelDeletionMutationVariables,
} from '../graphql/generated';
import { BackgroundJobReceiptNode } from '../graphql/types/BackgroundJobReceipt';

export async function scheduleChannelDeletionAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    channelId,
  }: {
    channelId: string;
  }
): Promise<BackgroundJobReceiptDataFragment> {
  const result = await withErrorHandlingAsync(
    graphqlClient
      .mutation<ScheduleChannelDeletionMutation, ScheduleChannelDeletionMutationVariables>(
        gql`
          mutation ScheduleChannelDeletion($channelId: ID!) {
            updateChannel {
              scheduleUpdateChannelDeletion(channelId: $channelId) {
                id
                ...BackgroundJobReceiptData
              }
            }
          }
          ${BackgroundJobReceiptNode}
        `,
        { channelId }
      )
      .toPromise()
  );
  return result.updateChannel.scheduleUpdateChannelDeletion;
}
