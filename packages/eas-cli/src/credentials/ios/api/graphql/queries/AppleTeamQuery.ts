import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleTeamByIdentifierQuery,
  AppleTeamFilterInput,
  AppleTeamFragment,
  AppleTeamsPaginatedByAccountQuery,
} from '../../../../../graphql/generated';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';
import { Connection } from '../../../../../utils/relay';

export const AppleTeamQuery = {
  async getAllForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      accountName,
      offset,
      limit,
    }: { accountName: string; offset?: number | null; limit?: number | null }
  ): Promise<AppleTeamFragment[]> {
    // appleTeamsPaginated is cursor-based, so emulate offset/limit by fetching
    // pages from the start until enough nodes are collected
    const start = offset ?? 0;
    const teams: AppleTeamFragment[] = [];
    let after: string | undefined;
    while (limit == null || teams.length < start + limit) {
      const connection = await AppleTeamQuery.getAllForAccountPaginatedAsync(
        graphqlClient,
        accountName,
        { first: 100, after }
      );
      teams.push(...connection.edges.map(edge => edge.node));
      if (!connection.pageInfo.hasNextPage) {
        break;
      }
      after = connection.pageInfo.endCursor ?? undefined;
    }
    return limit == null ? teams.slice(start) : teams.slice(start, start + limit);
  },
  async getAllForAccountPaginatedAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string,
    {
      after,
      first,
      before,
      last,
      filter,
    }: {
      after?: string;
      first?: number;
      before?: string;
      last?: number;
      filter?: AppleTeamFilterInput;
    }
  ): Promise<Connection<AppleTeamFragment>> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleTeamsPaginatedByAccountQuery>(
          gql`
            query AppleTeamsPaginatedByAccountQuery(
              $accountName: String!
              $after: String
              $first: Int
              $before: String
              $last: Int
              $filter: AppleTeamFilterInput
            ) {
              account {
                byName(accountName: $accountName) {
                  id
                  appleTeamsPaginated(
                    after: $after
                    first: $first
                    before: $before
                    last: $last
                    filter: $filter
                  ) {
                    edges {
                      cursor
                      node {
                        id
                        ...AppleTeamFragment
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
            ${print(AppleTeamFragmentNode)}
          `,
          { accountName, after, first, before, last, filter },
          {
            additionalTypenames: ['AppleTeam'],
          }
        )
        .toPromise()
    );

    return data.account.byName.appleTeamsPaginated;
  },
  async getByAppleTeamIdentifierAsync(
    graphqlClient: ExpoGraphqlClient,
    accountId: string,
    appleTeamIdentifier: string
  ): Promise<AppleTeamFragment | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleTeamByIdentifierQuery>(
          gql`
            query AppleTeamByIdentifierQuery($accountId: ID!, $appleTeamIdentifier: String!) {
              appleTeam {
                byAppleTeamIdentifier(accountId: $accountId, identifier: $appleTeamIdentifier) {
                  id
                  ...AppleTeamFragment
                }
              }
            }
            ${print(AppleTeamFragmentNode)}
          `,
          {
            accountId,
            appleTeamIdentifier,
          },
          {
            additionalTypenames: ['AppleTeam'],
          }
        )
        .toPromise()
    );
    return data.appleTeam.byAppleTeamIdentifier ?? null;
  },
};
