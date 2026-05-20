import { CombinedError } from '@urql/core';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform, EmbeddedUpdate } from '../generated';
import { Connection } from '../../utils/relay';
import { withErrorHandlingAsync } from '../client';

export function isEmbeddedUpdateNotFoundError(error: unknown): boolean {
  return (
    error instanceof CombinedError &&
    error.graphQLErrors.some(e => e.extensions?.['errorCode'] === 'EMBEDDED_UPDATE_NOT_FOUND')
  );
}

// Query result types are defined manually because the embeddedUpdates query fields
// are not yet included in the GraphQL codegen schema.
export type EmbeddedUpdateFragment = Pick<
  EmbeddedUpdate,
  'id' | 'platform' | 'runtimeVersion' | 'channel' | 'createdAt'
>;

type ViewEmbeddedUpdateByIdQueryResult = {
  embeddedUpdates: {
    byId: EmbeddedUpdateFragment;
  };
};

type ViewEmbeddedUpdateByIdQueryVariables = {
  embeddedUpdateId: string;
  appId: string;
};

type ViewEmbeddedUpdatesPaginatedQueryResult = {
  app: {
    byId: {
      embeddedUpdatesPaginated: {
        edges: { cursor: string; node: EmbeddedUpdateFragment }[];
        pageInfo: {
          hasNextPage: boolean;
          hasPreviousPage: boolean;
          startCursor: string | null;
          endCursor: string | null;
        };
      };
    };
  };
};

type ViewEmbeddedUpdatesPaginatedQueryVariables = {
  appId: string;
  first: number;
  after?: string;
  filter?: EmbeddedUpdateFilter;
};

export type EmbeddedUpdateFilter = {
  platform?: AppPlatform;
  runtimeVersion?: string;
  channel?: string;
};

export const EmbeddedUpdateQuery = {
  async viewByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    { embeddedUpdateId, appId }: { embeddedUpdateId: string; appId: string }
  ): Promise<EmbeddedUpdateFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewEmbeddedUpdateByIdQueryResult, ViewEmbeddedUpdateByIdQueryVariables>(
          gql`
            query ViewEmbeddedUpdateById($embeddedUpdateId: ID!, $appId: ID!) {
              embeddedUpdates {
                byId(embeddedUpdateId: $embeddedUpdateId, appId: $appId) {
                  id
                  platform
                  runtimeVersion
                  channel
                  createdAt
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
    }: {
      appId: string;
      filter?: EmbeddedUpdateFilter;
      first: number;
      after?: string;
    }
  ): Promise<Connection<EmbeddedUpdateFragment>> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<ViewEmbeddedUpdatesPaginatedQueryResult, ViewEmbeddedUpdatesPaginatedQueryVariables>(
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
