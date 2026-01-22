import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AccountFullUsageQuery as AccountFullUsageQueryType,
  AccountFullUsageQueryVariables,
} from '../generated';

const ACCOUNT_FULL_USAGE_QUERY = gql`
  query AccountFullUsage($accountId: String!, $currentDate: DateTime!) {
    account {
      byId(accountId: $accountId) {
        id
        name
        subscription {
          id
          name
          status
          nextInvoice
          nextInvoiceAmountDueCents
          recurringCents
          price
        }
        billingPeriod(date: $currentDate) {
          id
          start
          end
          anchor
        }
        usageMetrics {
          EAS_BUILD: byBillingPeriod(date: $currentDate, service: BUILDS) {
            id
            billingPeriod {
              id
              start
              end
            }
            planMetrics {
              id
              service
              serviceMetric
              metricType
              value
              limit
              platformBreakdown {
                ios {
                  value
                  limit
                }
                android {
                  value
                  limit
                }
              }
            }
            overageMetrics {
              id
              service
              serviceMetric
              metricType
              value
              limit
              totalCost
            }
            totalCost
          }
          EAS_UPDATE: byBillingPeriod(date: $currentDate, service: UPDATES) {
            id
            billingPeriod {
              id
              start
              end
            }
            planMetrics {
              id
              service
              serviceMetric
              metricType
              value
              limit
            }
            overageMetrics {
              id
              service
              serviceMetric
              metricType
              value
              limit
              totalCost
            }
            totalCost
          }
        }
      }
    }
  }
`;

export type AccountFullUsageData = NonNullable<AccountFullUsageQueryType['account']['byId']>;

export const AccountFullUsageQuery = {
  async getFullUsageAsync(
    graphqlClient: ExpoGraphqlClient,
    accountId: string,
    currentDate: Date
  ): Promise<AccountFullUsageData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AccountFullUsageQueryType, AccountFullUsageQueryVariables>(
          ACCOUNT_FULL_USAGE_QUERY,
          {
            accountId,
            currentDate: currentDate.toISOString(),
          },
          {
            additionalTypenames: [
              'Account',
              'AccountUsageMetrics',
              'UsageMetricTotal',
              'BillingPeriod',
              'EstimatedUsage',
              'EstimatedOverageAndCost',
            ],
          }
        )
        .toPromise()
    );

    if (!data.account.byId) {
      throw new Error(`Account with ID ${accountId} not found`);
    }

    return data.account.byId;
  },
};
