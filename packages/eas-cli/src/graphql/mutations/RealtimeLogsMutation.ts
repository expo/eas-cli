import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  GenerateRealtimeLogsCentrifugoConnectionTokenMutation,
  GenerateRealtimeLogsCentrifugoConnectionTokenMutationVariables,
  GenerateRealtimeLogsCentrifugoSubscriptionTokenMutation,
  GenerateRealtimeLogsCentrifugoSubscriptionTokenMutationVariables,
  RealtimeLogsCentrifugoConnectionToken,
  RealtimeLogsCentrifugoSubscriptionToken,
  RealtimeLogsMutation_GenerateCentrifugoSubscriptionTokenArgs,
} from '../generated';

export const RealtimeLogsMutation = {
  async generateCentrifugoConnectionTokenAsync(
    graphqlClient: ExpoGraphqlClient
  ): Promise<RealtimeLogsCentrifugoConnectionToken> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          GenerateRealtimeLogsCentrifugoConnectionTokenMutation,
          GenerateRealtimeLogsCentrifugoConnectionTokenMutationVariables
        >(
          gql`
            mutation GenerateRealtimeLogsCentrifugoConnectionToken {
              realtimeLogs {
                generateCentrifugoConnectionToken {
                  token
                }
              }
            }
          `,
          {}
        )
        .toPromise()
    );
    return data.realtimeLogs.generateCentrifugoConnectionToken;
  },
  async generateCentrifugoSubscriptionTokenAsync(
    graphqlClient: ExpoGraphqlClient,
    { target, thread }: RealtimeLogsMutation_GenerateCentrifugoSubscriptionTokenArgs
  ): Promise<RealtimeLogsCentrifugoSubscriptionToken> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          GenerateRealtimeLogsCentrifugoSubscriptionTokenMutation,
          GenerateRealtimeLogsCentrifugoSubscriptionTokenMutationVariables
        >(
          gql`
            mutation GenerateRealtimeLogsCentrifugoSubscriptionToken(
              $target: RealtimeLogsTargetInput!
              $thread: String
            ) {
              realtimeLogs {
                generateCentrifugoSubscriptionToken(target: $target, thread: $thread) {
                  channel
                  token
                }
              }
            }
          `,
          { target, thread }
        )
        .toPromise()
    );
    return data.realtimeLogs.generateCentrifugoSubscriptionToken;
  },
};
