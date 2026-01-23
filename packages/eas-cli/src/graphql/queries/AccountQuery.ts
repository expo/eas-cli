import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AccountFullUsageQuery as AccountFullUsageQueryType,
  AccountFullUsageQueryVariables,
  AccountUsageForOverageWarningQuery,
  AccountUsageForOverageWarningQueryVariables,
} from '../generated';

const ACCOUNT_BY_NAME_QUERY = gql`
  query AccountByName($accountName: String!) {
    account {
      byName(accountName: $accountName) {
        id
        name
      }
    }
  }
`;

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
              metadata {
                ... on AccountUsageEASBuildMetadata {
                  billingResourceClass
                  platform
                }
              }
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

const ACCOUNT_USAGE_FOR_OVERAGE_WARNING_QUERY = gql`
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
        }
      }
    }
  }
`;

export type AccountFullUsageData = NonNullable<AccountFullUsageQueryType['account']['byId']>;

export const AccountQuery = {
  async getByNameAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string
  ): Promise<{ id: string; name: string } | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ account: { byName: { id: string; name: string } | null } }>(
          ACCOUNT_BY_NAME_QUERY,
          { accountName },
          { additionalTypenames: ['Account'] }
        )
        .toPromise()
    );

    return data.account.byName;
  },

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

  async getUsageForOverageWarningAsync(
    graphqlClient: ExpoGraphqlClient,
    accountId: string,
    currentDate: Date
  ): Promise<AccountUsageForOverageWarningQuery['account']['byId']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AccountUsageForOverageWarningQuery, AccountUsageForOverageWarningQueryVariables>(
          ACCOUNT_USAGE_FOR_OVERAGE_WARNING_QUERY,
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
