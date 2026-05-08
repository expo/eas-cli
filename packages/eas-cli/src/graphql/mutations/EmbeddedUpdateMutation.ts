import { CombinedError } from '@urql/core';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../generated';
import { withErrorHandlingAsync } from '../client';

export type EmbeddedUpdateResult = {
  id: string;
  platform: AppPlatform;
  runtimeVersion: string;
  channelId: string;
  createdAt: string;
};

type UploadEmbeddedUpdateInput = {
  appId: string;
  platform: AppPlatform;
  runtimeVersion: string;
  channelId: string;
  embeddedUpdateId: string;
  launchAssetStorageKey: string;
  turtleBuildId?: string;
};

type UploadEmbeddedUpdateMutationResult = {
  embeddedUpdate: {
    uploadEmbeddedUpdate: EmbeddedUpdateResult;
  };
};

export function isEmbeddedUpdateAssetNotReadyError(error: unknown): boolean {
  return (
    error instanceof CombinedError &&
    error.graphQLErrors.some(
      e => e.extensions?.['errorCode'] === 'EMBEDDED_UPDATE_ASSET_NOT_READY'
    )
  );
}

export function isEmbeddedUpdateConflictError(error: unknown): boolean {
  return (
    error instanceof CombinedError &&
    error.graphQLErrors.some(e => e.extensions?.['errorCode'] === 'EMBEDDED_UPDATE_CONFLICT')
  );
}

export const EmbeddedUpdateMutation = {
  async uploadEmbeddedUpdateAsync(
    graphqlClient: ExpoGraphqlClient,
    input: UploadEmbeddedUpdateInput
  ): Promise<EmbeddedUpdateResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UploadEmbeddedUpdateMutationResult>(
          gql`
            mutation UploadEmbeddedUpdate($input: UploadEmbeddedUpdateInput!) {
              embeddedUpdate {
                uploadEmbeddedUpdate(input: $input) {
                  id
                  platform
                  runtimeVersion
                  channelId
                  createdAt
                }
              }
            }
          `,
          { input }
        )
        .toPromise()
    );
    return data.embeddedUpdate.uploadEmbeddedUpdate;
  },
};
