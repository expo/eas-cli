import { CombinedError } from '@urql/core';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { ViewEmbeddedUpdateByIdQuery, ViewEmbeddedUpdateByIdQueryVariables } from '../generated';

export function isEmbeddedUpdateNotFoundError(error: unknown): boolean {
  if (!(error instanceof CombinedError)) {
    return false;
  }
  return error.graphQLErrors.some(e => {
    const code = e.extensions?.['errorCode'];
    return code === 'EMBEDDED_UPDATE_NOT_FOUND' || code === 'NOT_FOUND_ERROR';
  });
}

export type EmbeddedUpdateFragment = ViewEmbeddedUpdateByIdQuery['embeddedUpdates']['byId'];

export const EmbeddedUpdateQuery = {
  async viewByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    { embeddedUpdateId, appId }: { embeddedUpdateId: string; appId: string }
  ): Promise<EmbeddedUpdateFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewEmbeddedUpdateByIdQuery, ViewEmbeddedUpdateByIdQueryVariables>(
          gql`
            query ViewEmbeddedUpdateById($embeddedUpdateId: ID!, $appId: ID!) {
              embeddedUpdates {
                byId(embeddedUpdateId: $embeddedUpdateId, appId: $appId) {
                  id
                  platform
                  runtimeVersion
                  channel
                  createdAt
                  launchAsset {
                    id
                    fileSize
                    finalFileSize
                    fileSHA256
                  }
                }
              }
            }
          `,
          { embeddedUpdateId, appId },
          { additionalTypenames: ['EmbeddedUpdate'] }
        )
        .toPromise()
    );
    return data.embeddedUpdates.byId;
  },
};
