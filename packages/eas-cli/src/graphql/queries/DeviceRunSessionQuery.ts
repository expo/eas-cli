import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { DeviceRunSessionByIdQuery, DeviceRunSessionByIdQueryVariables } from '../generated';

export const DeviceRunSessionQuery = {
  async byIdAsync(
    graphqlClient: ExpoGraphqlClient,
    deviceRunSessionId: string
  ): Promise<DeviceRunSessionByIdQuery['deviceRunSessions']['byId']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<DeviceRunSessionByIdQuery, DeviceRunSessionByIdQueryVariables>(
          gql`
            query DeviceRunSessionByIdQuery($deviceRunSessionId: ID!) {
              deviceRunSessions {
                byId(deviceRunSessionId: $deviceRunSessionId) {
                  id
                  status
                  turtleJobRun {
                    id
                    status
                    logFileUrls
                  }
                }
              }
            }
          `,
          { deviceRunSessionId },
          { requestPolicy: 'network-only' }
        )
        .toPromise()
    );
    return data.deviceRunSessions.byId;
  },
};
