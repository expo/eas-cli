import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  DeviceRunSessionByIdQuery,
  DeviceRunSessionByIdQueryVariables,
  DeviceRunSessionEventLogByIdQuery,
  DeviceRunSessionEventLogByIdQueryVariables,
  DeviceRunSessionFilterInput,
  DeviceRunSessionsByAppIdQuery,
  DeviceRunSessionsByAppIdQueryVariables,
} from '../generated';

export const DeviceRunSessionQuery = {
  async eventLogByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    deviceRunSessionId: string
  ): Promise<DeviceRunSessionEventLogByIdQuery['deviceRunSessions']['byId']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<DeviceRunSessionEventLogByIdQuery, DeviceRunSessionEventLogByIdQueryVariables>(
          gql`
            query DeviceRunSessionEventLogByIdQuery($deviceRunSessionId: ID!) {
              deviceRunSessions {
                byId(deviceRunSessionId: $deviceRunSessionId) {
                  id
                  status
                  eventLog {
                    fileUrl
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
                  type
                  platform
                  createdAt
                  startedAt
                  finishedAt
                  updatedAt
                  app {
                    id
                    slug
                    ownerAccount {
                      id
                      name
                    }
                  }
                  artifacts {
                    id
                    name
                    filename
                    downloadUrl
                    fileSizeBytes
                    metadata
                    createdAt
                    updatedAt
                  }
                  remoteConfig {
                    __typename
                    ... on AgentDeviceRunSessionRemoteConfig {
                      agentDeviceRemoteSessionUrl
                      agentDeviceRemoteSessionToken
                      webPreviewUrl
                    }
                    ... on ArgentRunSessionRemoteConfig {
                      toolsUrl
                      toolsAuthToken
                      webPreviewUrl
                    }
                    ... on ServeSimRunSessionRemoteConfig {
                      previewUrl
                      streamUrl
                    }
                  }
                  turtleJobRun {
                    id
                    status
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
  async listByAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      first,
      after,
      filter,
    }: {
      appId: string;
      first?: number;
      after?: string;
      filter?: DeviceRunSessionFilterInput;
    }
  ): Promise<DeviceRunSessionsByAppIdQuery['app']['byId']['deviceRunSessionsPaginated']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<DeviceRunSessionsByAppIdQuery, DeviceRunSessionsByAppIdQueryVariables>(
          gql`
            query DeviceRunSessionsByAppId(
              $appId: String!
              $first: Int
              $after: String
              $filter: DeviceRunSessionFilterInput
            ) {
              app {
                byId(appId: $appId) {
                  id
                  deviceRunSessionsPaginated(first: $first, after: $after, filter: $filter) {
                    edges {
                      cursor
                      node {
                        id
                        status
                        type
                        platform
                        createdAt
                        startedAt
                        finishedAt
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
                          status
                        }
                      }
                    }
                    pageInfo {
                      hasNextPage
                      hasPreviousPage
                      startCursor
                      endCursor
                    }
                  }
                }
              }
            }
          `,
          { appId, first, after, filter },
          { requestPolicy: 'network-only' }
        )
        .toPromise()
    );
    return data.app.byId.deviceRunSessionsPaginated;
  },
};
