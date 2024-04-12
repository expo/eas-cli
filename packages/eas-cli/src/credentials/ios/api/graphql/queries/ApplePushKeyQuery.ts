import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  ApplePushKeyFragment,
  ApplePushKeysPaginatedByAccountQuery,
} from '../../../../../graphql/generated';
import { ApplePushKeyFragmentNode } from '../../../../../graphql/types/credentials/ApplePushKey';
import { Connection, QueryParams, fetchEntireDatasetAsync } from '../../../../../utils/relay';

export const ApplePushKeyQuery = {
  async getAllForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string
  ): Promise<ApplePushKeyFragment[]> {
    const paginatedGetterAsync = async (
      relayArgs: QueryParams
    ): Promise<Connection<ApplePushKeyFragment>> => {
      return await ApplePushKeyQuery.getAllForAccountPaginatedAsync(
        graphqlClient,
        accountName,
        relayArgs
      );
    };
    return await fetchEntireDatasetAsync({
      paginatedGetterAsync,
      progressBarLabel: 'fetching Apple Push Keys...',
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
  ): Promise<ApplePushKeysPaginatedByAccountQuery['account']['byName']['applePushKeysPaginated']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<ApplePushKeysPaginatedByAccountQuery>(
          gql`
            query ApplePushKeysPaginatedByAccountQuery(
              $accountName: String!
              $after: String
              $first: Int
              $before: String
              $last: Int
            ) {
              account {
                byName(accountName: $accountName) {
                  id
                  applePushKeysPaginated(
                    after: $after
                    first: $first
                    before: $before
                    last: $last
                  ) {
                    edges {
                      cursor
                      node {
                        id
                        ...ApplePushKeyFragment
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
            ${print(ApplePushKeyFragmentNode)}
          `,
          {
            accountName,
            after,
            first,
            before,
            last,
          },
          {
            additionalTypenames: ['ApplePushKey'],
          }
        )
        .toPromise()
    );
    return data.account.byName.applePushKeysPaginated;
  },
};
