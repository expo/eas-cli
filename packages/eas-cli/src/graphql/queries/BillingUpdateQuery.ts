import assert from 'assert';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { BillingUpdateByAccountQuery } from '../generated';

export const BillingUpdateQuery = {
  async byAccountIdAsync(
    graphqlClient: ExpoGraphqlClient,
    accountId: string,
    date: Date
  ): Promise<BillingUpdateByAccountQuery['account']['byId']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<BillingUpdateByAccountQuery>(
          gql`
            query BillingUpdateByAccountQuery($accountId: String!, $date: DateTime!) {
              account {
                byId(accountId: $accountId) {
                  id
                  billing {
                    id
                    subscription {
                      id
                      name
                      meteredBillingStatus {
                        EAS_UPDATE
                      }
                    }
                  }
                  usageMetrics {
                    byBillingPeriod(date: $date, service: UPDATES) {
                      id
                      planMetrics {
                        id
                        serviceMetric
                        metricType
                        value
                        limit
                      }
                    }
                  }
                }
              }
            }
          `,
          { accountId, date },
          {
            additionalTypenames: [
              'Account',
              'Billing',
              'SubscriptionDetails',
              'AccountUsageMetrics',
              'UsageMetricTotal',
              'EstimatedUsage',
            ],
          }
        )
        .toPromise()
    );

    assert(data.account, 'GraphQL: `account` not defined in server response');
    return data.account.byId;
  },
};
