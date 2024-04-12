import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppStoreConnectApiKeyFragment,
  AppStoreConnectApiKeysPaginatedByAccountQuery,
} from '../../../../../graphql/generated';
import { AppStoreConnectApiKeyFragmentNode } from '../../../../../graphql/types/credentials/AppStoreConnectApiKey';
import { Connection, QueryParams, fetchEntireDatasetAsync } from '../../../../../utils/relay';

export const AppStoreConnectApiKeyQuery = {
  async getAllForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string
  ): Promise<AppStoreConnectApiKeyFragment[]> {
    const paginatedGetterAsync = async (
      relayArgs: QueryParams
    ): Promise<Connection<AppStoreConnectApiKeyFragment>> => {
      return await AppStoreConnectApiKeyQuery.getAllForAccountPaginatedAsync(
        graphqlClient,
        accountName,
        relayArgs
      );
    };
    return await fetchEntireDatasetAsync({
      paginatedGetterAsync,
      progressBarLabel: 'fetching ASC Keys...',
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
    AppStoreConnectApiKeysPaginatedByAccountQuery['account']['byName']['appStoreConnectApiKeysPaginated']
  > {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppStoreConnectApiKeysPaginatedByAccountQuery>(
          gql`
            query AppStoreConnectApiKeysPaginatedByAccountQuery(
              $accountName: String!
              $after: String
              $first: Int
              $before: String
              $last: Int
            ) {
              account {
                byName(accountName: $accountName) {
                  id
                  appStoreConnectApiKeysPaginated(
                    after: $after
                    first: $first
                    before: $before
                    last: $last
                  ) {
                    edges {
                      cursor
                      node {
                        id
                        ...AppStoreConnectApiKeyFragment
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
            ${print(AppStoreConnectApiKeyFragmentNode)}
          `,
          {
            accountName,
            after,
            first,
            before,
            last,
          },
          {
            additionalTypenames: ['AppStoreConnectApiKey'],
          }
        )
        .toPromise()
    );
    return data.account.byName.appStoreConnectApiKeysPaginated;
  },
};
