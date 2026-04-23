import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateDeviceRunSessionInput,
  CreateDeviceRunSessionMutation,
  CreateDeviceRunSessionMutationVariables,
} from '../generated';

export const DeviceRunSessionMutation = {
  async createDeviceRunSessionAsync(
    graphqlClient: ExpoGraphqlClient,
    deviceRunSessionInput: CreateDeviceRunSessionInput
  ): Promise<CreateDeviceRunSessionMutation['deviceRunSession']['createDeviceRunSession']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateDeviceRunSessionMutation, CreateDeviceRunSessionMutationVariables>(
          gql`
            mutation CreateDeviceRunSessionMutation($deviceRunSessionInput: CreateDeviceRunSessionInput!) {
              deviceRunSession {
                createDeviceRunSession(deviceRunSessionInput: $deviceRunSessionInput) {
                  id
                  status
                  app {
                    id
                    slug
                    ownerAccount {
                      id
                      name
                    }
                  }
                  turtleJobRun {
                    id
                  }
                }
              }
            }
          `,
          { deviceRunSessionInput },
          { noRetry: true }
        )
        .toPromise()
    );
    return data.deviceRunSession.createDeviceRunSession;
  },
};
