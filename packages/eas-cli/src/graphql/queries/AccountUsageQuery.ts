import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AccountUsageForOverageWarningQuery,
  AccountUsageForOverageWarningQueryVariables,
} from '../generated';

export const AccountUsageQuery = {
  async getUsageForOverageWarningAsync(
    graphqlClient: ExpoGraphqlClient,
    accountId: string,
    currentDate: Date
  ): Promise<AccountUsageForOverageWarningQuery['account']['byId']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AccountUsageForOverageWarningQuery, AccountUsageForOverageWarningQueryVariables>(
          gql`
            query AccountUsageForOverageWarning($accountId: String!, $currentDate: DateTime!) {
              account {
                byId(accountId: $accountId) {
                  id
                  name
                  subscription {
                    id
                    name
                  }
                  usageMetrics {
                    EAS_BUILD: byBillingPeriod(date: $currentDate, service: BUILDS) {
                      id
                      planMetrics {
                        id
                        serviceMetric
                        value
                        limit
                      }
                    }
                    EAS_UPDATE: byBillingPeriod(date: $currentDate, service: UPDATES) {
                      id
                      planMetrics {
                        id
                        serviceMetric
                        value
                        limit
                      }
                    }
                  }
                }
              }
            }
          `,
          { accountId, currentDate: currentDate.toISOString() },
          {
            additionalTypenames: ['Account', 'AccountUsageMetrics', 'UsageMetricTotal'],
          }
        )
        .toPromise()
    );

    return data.account.byId;
  },
};
