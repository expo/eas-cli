import { CombinedError } from '@urql/core';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  DeleteEmbeddedUpdateMutation,
  DeleteEmbeddedUpdateMutationVariables,
  UploadEmbeddedUpdateInput,
  UploadEmbeddedUpdateMutation,
  UploadEmbeddedUpdateMutationVariables,
} from '../generated';
import { withErrorHandlingAsync } from '../client';

export type EmbeddedUpdateResult = {
  id: string;
  platform: AppPlatform;
  runtimeVersion: string;
  channel: string;
  createdAt: string;
};

export function isEmbeddedUpdateAssetNotAvailableError(error: unknown): boolean {
  return (
    error instanceof CombinedError &&
    error.graphQLErrors.some(
      e => e.extensions?.['errorCode'] === 'EMBEDDED_UPDATE_ASSET_NOT_AVAILABLE'
    )
  );
}

export function isEmbeddedUpdateAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof CombinedError &&
    error.graphQLErrors.some(e => e.extensions?.['errorCode'] === 'EMBEDDED_UPDATE_ALREADY_EXISTS')
  );
}

export const EmbeddedUpdateMutation = {
  async uploadEmbeddedUpdateAsync(
    graphqlClient: ExpoGraphqlClient,
    input: UploadEmbeddedUpdateInput
  ): Promise<EmbeddedUpdateResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UploadEmbeddedUpdateMutation, UploadEmbeddedUpdateMutationVariables>(
          gql`
            mutation UploadEmbeddedUpdate($input: UploadEmbeddedUpdateInput!) {
              embeddedUpdate {
                uploadEmbeddedUpdate(input: $input) {
                  id
                  platform
                  runtimeVersion
                  channel
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

  async deleteEmbeddedUpdateAsync(
    graphqlClient: ExpoGraphqlClient,
    { id }: { id: string }
  ): Promise<{ id: string }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteEmbeddedUpdateMutation, DeleteEmbeddedUpdateMutationVariables>(
          gql`
            mutation DeleteEmbeddedUpdate($id: ID!) {
              embeddedUpdate {
                deleteEmbeddedUpdate(id: $id) {
                  id
                }
              }
            }
          `,
          { id }
        )
        .toPromise()
    );
    return data.embeddedUpdate.deleteEmbeddedUpdate;
  },
};
