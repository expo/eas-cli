import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  GoogleServiceAccountKeyFragment,
  GoogleServiceAccountKeysPaginatedByAccountQuery,
} from '../../../../../graphql/generated';
import { GoogleServiceAccountKeyFragmentNode } from '../../../../../graphql/types/credentials/GoogleServiceAccountKey';
import { Connection, QueryParams, fetchEntireDatasetAsync } from '../../../../../utils/relay';

export const GoogleServiceAccountKeyQuery = {
  async getAllForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string
  ): Promise<GoogleServiceAccountKeyFragment[]> {
    const paginatedGetterAsync = async (
      relayArgs: QueryParams
    ): Promise<Connection<GoogleServiceAccountKeyFragment>> => {
      return await GoogleServiceAccountKeyQuery.getAllForAccountPaginatedAsync(
        graphqlClient,
        accountName,
        relayArgs
      );
    };
    return await fetchEntireDatasetAsync({
      paginatedGetterAsync,
      progressBarLabel: 'fetching Google Service Account Keys...',
    });
  },
  async getAllForAccountPaginatedAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string,
    {
      after,
      first,
      before,
      last,
    }: { after?: string; first?: number; before?: string; last?: number }
  ): Promise<
    GoogleServiceAccountKeysPaginatedByAccountQuery['account']['byName']['googleServiceAccountKeysPaginated']
  > {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GoogleServiceAccountKeysPaginatedByAccountQuery>(
          gql`
            query GoogleServiceAccountKeysPaginatedByAccountQuery(
              $accountName: String!
              $after: String
              $first: Int
              $before: String
              $last: Int
            ) {
              account {
                byName(accountName: $accountName) {
                  id
                  googleServiceAccountKeysPaginated(
                    after: $after
                    first: $first
                    before: $before
                    last: $last
                  ) {
                    edges {
                      cursor
                      node {
                        id
                        ...GoogleServiceAccountKeyFragment
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
            ${print(GoogleServiceAccountKeyFragmentNode)}
          `,
          {
            accountName,
            after,
            first,
            before,
            last,
          },
          {
            additionalTypenames: ['GoogleServiceAccountKey'],
          }
        )
        .toPromise()
    );
    return data.account.byName.googleServiceAccountKeysPaginated;
  },
};
