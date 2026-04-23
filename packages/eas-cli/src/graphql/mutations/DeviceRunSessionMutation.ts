import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateDeviceRunSessionInput,
  CreateDeviceRunSessionMutation,
  CreateDeviceRunSessionMutationVariables,
  StopDeviceRunSessionMutation,
  StopDeviceRunSessionMutationVariables,
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
  async stopDeviceRunSessionAsync(
    graphqlClient: ExpoGraphqlClient,
    deviceRunSessionId: string
  ): Promise<StopDeviceRunSessionMutation['deviceRunSession']['stopDeviceRunSession']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<StopDeviceRunSessionMutation, StopDeviceRunSessionMutationVariables>(
          gql`
            mutation StopDeviceRunSessionMutation($deviceRunSessionId: ID!) {
              deviceRunSession {
                stopDeviceRunSession(deviceRunSessionId: $deviceRunSessionId) {
                  id
                  status
                }
              }
            }
          `,
          { deviceRunSessionId },
          { noRetry: true }
        )
        .toPromise()
    );
    return data.deviceRunSession.stopDeviceRunSession;
  },
};
