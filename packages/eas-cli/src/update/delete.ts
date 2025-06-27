import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../graphql/client';
import {
  BackgroundJobReceiptDataFragment,
  ScheduleUpdateGroupDeletionMutation,
  ScheduleUpdateGroupDeletionMutationVariables,
} from '../graphql/generated';
import { BackgroundJobReceiptNode } from '../graphql/types/BackgroundJobReceipt';

export async function scheduleUpdateGroupDeletionAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    group,
  }: {
    group: string;
  }
): Promise<BackgroundJobReceiptDataFragment> {
  const result = await withErrorHandlingAsync(
    graphqlClient
      .mutation<ScheduleUpdateGroupDeletionMutation, ScheduleUpdateGroupDeletionMutationVariables>(
        gql`
          mutation ScheduleUpdateGroupDeletion($group: ID!) {
            update {
              scheduleUpdateGroupDeletion(group: $group) {
                id
                ...BackgroundJobReceiptData
              }
            }
          }
          ${BackgroundJobReceiptNode}
        `,
        { group }
      )
      .toPromise()
  );
  return result.update.scheduleUpdateGroupDeletion;
}
