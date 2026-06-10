import { CombinedError } from '@urql/core';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { Connection } from '../../utils/relay';
import {
  EmbeddedUpdateFilterInput,
  ViewEmbeddedUpdateByIdQuery,
  ViewEmbeddedUpdateByIdQueryVariables,
  ViewEmbeddedUpdatesPaginatedQuery,
  ViewEmbeddedUpdatesPaginatedQueryVariables,
} from '../generated';
import { withErrorHandlingAsync } from '../client';

export function isEmbeddedUpdateNotFoundError(error: unknown): boolean {
  return (
    error instanceof CombinedError &&
    error.graphQLErrors.some(e => e.extensions?.['errorCode'] === 'EMBEDDED_UPDATE_NOT_FOUND')
  );
}

export type EmbeddedUpdateFragment = ViewEmbeddedUpdateByIdQuery['embeddedUpdates']['byId'];

export type EmbeddedUpdateFilter = EmbeddedUpdateFilterInput;

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

  async viewPaginatedAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      filter,
      first,
      after,
    }: { appId: string; filter?: EmbeddedUpdateFilter; first: number; after?: string }
  ): Promise<Connection<EmbeddedUpdateFragment>> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewEmbeddedUpdatesPaginatedQuery, ViewEmbeddedUpdatesPaginatedQueryVariables>(
          gql`
            query ViewEmbeddedUpdatesPaginated(
              $appId: String!
              $first: Int!
              $after: String
              $filter: EmbeddedUpdateFilterInput
            ) {
              app {
                byId(appId: $appId) {
                  id
                  embeddedUpdatesPaginated(first: $first, after: $after, filter: $filter) {
                    edges {
                      cursor
                      node {
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
          { additionalTypenames: ['EmbeddedUpdate'] }
        )
        .toPromise()
    );
    return data.app.byId.embeddedUpdatesPaginated;
  },
};
