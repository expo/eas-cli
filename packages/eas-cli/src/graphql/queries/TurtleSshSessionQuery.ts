import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  TurtleSshConnectInfoForResourceQuery,
  TurtleSshConnectInfoForResourceQueryVariables,
} from '../generated';

export type TurtleSshConnectInfo = NonNullable<
  TurtleSshConnectInfoForResourceQuery['turtleSshSessions']['connectInfoForResource']
>;
export type TurtleSshSession = NonNullable<TurtleSshConnectInfo['session']>;

export const TurtleSshSessionQuery = {
  async connectInfoForResourceAsync(
    graphqlClient: ExpoGraphqlClient,
    id: string
  ): Promise<TurtleSshConnectInfo | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<TurtleSshConnectInfoForResourceQuery, TurtleSshConnectInfoForResourceQueryVariables>(
          gql`
            query TurtleSshConnectInfoForResource($id: ID!) {
              turtleSshSessions {
                connectInfoForResource(id: $id) {
                  sshRequested
                  jobCompleted
                  session {
                    id
                    connectionConfig {
                      host
                      secret
                    }
                  }
                }
              }
            }
          `,
          { id },
          { requestPolicy: 'network-only' }
        )
        .toPromise()
    );
    return data.turtleSshSessions.connectInfoForResource ?? null;
  },
};
