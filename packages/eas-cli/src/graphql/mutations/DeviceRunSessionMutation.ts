import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CreateDeviceRunSessionMutation,
  CreateDeviceRunSessionMutationVariables,
  EnsureDeviceRunSessionStoppedMutation,
  EnsureDeviceRunSessionStoppedMutationVariables,
  CreateDeviceRunSessionInput as GeneratedCreateDeviceRunSessionInput,
} from '../generated';

export type CreateDeviceRunSessionInput = Omit<
  GeneratedCreateDeviceRunSessionInput,
  'deviceIdentifier'
> & {
  android?: {
    deviceIdentifier?: string;
    systemImagePackage?: string;
  };
  ios?: {
    deviceIdentifier?: string;
  };
};

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
  async ensureDeviceRunSessionStoppedAsync(
    graphqlClient: ExpoGraphqlClient,
    deviceRunSessionId: string
  ): Promise<
    EnsureDeviceRunSessionStoppedMutation['deviceRunSession']['ensureDeviceRunSessionStopped']
  > {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<
          EnsureDeviceRunSessionStoppedMutation,
          EnsureDeviceRunSessionStoppedMutationVariables
        >(
          gql`
            mutation EnsureDeviceRunSessionStoppedMutation($deviceRunSessionId: ID!) {
              deviceRunSession {
                ensureDeviceRunSessionStopped(deviceRunSessionId: $deviceRunSessionId) {
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
    return data.deviceRunSession.ensureDeviceRunSessionStopped;
  },
};
