import { OperationResult, OperationResultSource } from '@urql/core';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  DeviceRunSessionByIdQuery,
  DeviceRunSessionByIdQueryVariables,
  DeviceRunSessionEventsByIdQuery,
  DeviceRunSessionEventsByIdQueryVariables,
  DeviceRunSessionFilterInput,
  DeviceRunSessionJobRunErrorsByIdQuery,
  DeviceRunSessionJobRunErrorsByIdQueryVariables,
  DeviceRunSessionsByAppIdQuery,
  DeviceRunSessionsByAppIdQueryVariables,
} from '../generated';

export const DeviceRunSessionQuery = {
  async eventsByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    deviceRunSessionId: string
  ): Promise<DeviceRunSessionEventsByIdQuery['deviceRunSessions']['byId']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<DeviceRunSessionEventsByIdQuery, DeviceRunSessionEventsByIdQueryVariables>(
          gql`
            query DeviceRunSessionEventsByIdQuery($deviceRunSessionId: ID!) {
              deviceRunSessions {
                byId(deviceRunSessionId: $deviceRunSessionId) {
                  id
                  status
                  artifacts {
                    id
                    downloadUrl
                    metadata
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
  /**
   * Best-effort lookup of why the session's job run failed. It doesn't retry or print errors, and it
   * rejects with `signal.reason` and cancels the request when `signal` aborts.
   */
  async jobRunErrorsByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    deviceRunSessionId: string,
    { signal }: { signal: AbortSignal }
  ): Promise<DeviceRunSessionJobRunErrorsByIdQuery['deviceRunSessions']['byId']['turtleJobRun']> {
    const { data, error } = await firstResultUntilAbortedAsync(
      graphqlClient.query<
        DeviceRunSessionJobRunErrorsByIdQuery,
        DeviceRunSessionJobRunErrorsByIdQueryVariables
      >(
        gql`
          query DeviceRunSessionJobRunErrorsByIdQuery($deviceRunSessionId: ID!) {
            deviceRunSessions {
              byId(deviceRunSessionId: $deviceRunSessionId) {
                id
                turtleJobRun {
                  id
                  errors {
                    errorCode
                    message
                    docsUrl
                  }
                  logFileUrls
                }
              }
            }
          }
        `,
        { deviceRunSessionId },
        // Retries would keep a timer alive after the caller gives up.
        { requestPolicy: 'network-only', noRetry: true }
      ),
      signal
    );
    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error('Returned query result data is null!');
    }
    return data.deviceRunSessions.byId.turtleJobRun;
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
                  name
                  tags
                  publicPreview
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
                      webPreviewToken
                      previewApiUrl
                      egressUrl
                      egressToken
                      egressFingerprint
                      egressPort
                    }
                    ... on ArgentRunSessionRemoteConfig {
                      egressUrl
                      egressToken
                      egressFingerprint
                      egressPort
                      toolsUrl
                      toolsAuthToken
                      webPreviewUrl
                      webPreviewToken
                      previewApiUrl
                    }
                    ... on AppiumRunSessionRemoteConfig {
                      egressUrl
                      egressToken
                      egressFingerprint
                      egressPort
                      appiumUrl
                      capabilities
                      webPreviewUrl
                      webPreviewToken
                      previewApiUrl
                    }
                    ... on ServeSimRunSessionRemoteConfig {
                      egressUrl
                      egressToken
                      egressFingerprint
                      egressPort
                      previewUrl
                      previewToken
                      previewApiUrl
                    }
                    ... on WebPreviewOnlyRunSessionRemoteConfig {
                      egressUrl
                      egressToken
                      egressFingerprint
                      egressPort
                      previewUrl: webPreviewUrl
                      previewToken: webPreviewToken
                      previewApiUrl
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
                        name
                        tags
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

// Like `toPromise()`, but unsubscribing on abort makes urql cancel the request.
async function firstResultUntilAbortedAsync<T extends OperationResult>(
  source: OperationResultSource<T>,
  signal: AbortSignal
): Promise<T> {
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    let subscription: { unsubscribe: () => void } | undefined;
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      subscription?.unsubscribe();
      finish();
    };
    const onAbort = (): void => {
      settle(() => {
        reject(signal.reason);
      });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    subscription = source.subscribe(result => {
      if (!result.stale && !result.hasNext) {
        settle(() => {
          resolve(result);
        });
      }
    });
    // The result can arrive synchronously, before `subscription` is assigned.
    if (settled) {
      subscription.unsubscribe();
    }
  });
}
