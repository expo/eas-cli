import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../graphql/client';
import {
  BackgroundJobReceiptDataFragment,
  ScheduleBranchDeletionMutation,
  ScheduleBranchDeletionMutationVariables,
} from '../graphql/generated';
import { BackgroundJobReceiptNode } from '../graphql/types/BackgroundJobReceipt';

export async function scheduleBranchDeletionAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    branchId,
  }: {
    branchId: string;
  }
): Promise<BackgroundJobReceiptDataFragment> {
  const result = await withErrorHandlingAsync(
    graphqlClient
      .mutation<ScheduleBranchDeletionMutation, ScheduleBranchDeletionMutationVariables>(
        gql`
          mutation ScheduleBranchDeletion($branchId: ID!) {
            updateBranch {
              scheduleUpdateBranchDeletion(branchId: $branchId) {
                id
                ...BackgroundJobReceiptData
              }
            }
          }
          ${BackgroundJobReceiptNode}
        `,
        { branchId }
      )
      .toPromise()
  );
  return result.updateBranch.scheduleUpdateBranchDeletion;
}
