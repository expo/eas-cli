import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { Connection, QueryParams } from '../../utils/relay';
import { withErrorHandlingAsync } from '../client';
import {
  AuditLogFragment,
  AuditLogsByAccountQuery,
  AuditLogsByAccountQueryVariables,
} from '../generated';
import { AuditLogFragmentNode } from '../types/AuditLog';

export const AuditLogQuery = {
  async getAllForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    accountId: string,
    queryParams: QueryParams
  ): Promise<Connection<AuditLogFragment>> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AuditLogsByAccountQuery, AuditLogsByAccountQueryVariables>(
          gql`
            query AuditLogsByAccount(
              $accountId: String!
              $first: Int
              $after: String
              $last: Int
              $before: String
            ) {
              account {
                byId(accountId: $accountId) {
                  id
                  auditLogsPaginated(
                    first: $first
                    after: $after
                    last: $last
                    before: $before
                  ) {
                    edges {
                      cursor
                      node {
                        id
                        ...AuditLogFragment
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
            ${print(AuditLogFragmentNode)}
          `,
          {
            accountId,
            first: queryParams.first,
            after: queryParams.after,
            last: queryParams.last,
            before: queryParams.before,
          },
          { additionalTypenames: ['AuditLog'] }
        )
        .toPromise()
    );

    return data.account.byId.auditLogsPaginated;
  },
};
