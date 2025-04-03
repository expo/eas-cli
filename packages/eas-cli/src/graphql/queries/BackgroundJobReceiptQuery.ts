import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  BackgroundJobReceiptByIdQuery,
  BackgroundJobReceiptByIdQueryVariables,
} from '../generated';
import { BackgroundJobReceiptNode } from '../types/BackgroundJobReceipt';

export const BackgroundJobReceiptQuery = {
  async byIdAsync(
    graphqlClient: ExpoGraphqlClient,
    backgroundJobReceiptId: string
  ): Promise<BackgroundJobReceiptByIdQuery['backgroundJobReceipt']['byId'] | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<BackgroundJobReceiptByIdQuery, BackgroundJobReceiptByIdQueryVariables>(
          gql`
            query BackgroundJobReceiptById($id: ID!) {
              backgroundJobReceipt {
                byId(id: $id) {
                  id
                  ...BackgroundJobReceiptData
                }
              }
            }
            ${BackgroundJobReceiptNode}
          `,
          { id: backgroundJobReceiptId },
          {
            additionalTypenames: ['BackgroundJobReceipt'],
          }
        )
        .toPromise()
    );

    return data.backgroundJobReceipt.byId ?? null;
  },
};
