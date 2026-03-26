import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AccountFullUsageQuery as AccountFullUsageQueryType,
  AccountFullUsageQueryVariables,
  AccountUsageForOverageWarningQuery,
  AccountUsageForOverageWarningQueryVariables,
} from '../generated';
import {
  AccountUsageMetricFragmentNode,
  BillingPeriodFragmentNode,
  SubscriptionDetailsFragmentNode,
  UsageMetricTotalFragmentNode,
} from '../types/Account';

export type AccountFullUsageData = NonNullable<AccountFullUsageQueryType['account']['byId']>;

export const AccountQuery = {
  async getByNameAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string
  ): Promise<{ id: string; name: string } | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ account: { byName: { id: string; name: string } | null } }>(
          gql`
            query AccountByName($accountName: String!) {
              account {
                byName(accountName: $accountName) {
                  id
                  name
                }
              }
            }
          `,
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
    currentDate: Date,
    startDate: Date,
    endDate: Date
  ): Promise<AccountFullUsageData> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AccountFullUsageQueryType, AccountFullUsageQueryVariables>(
          gql`
            query AccountFullUsage(
              $accountId: String!
              $currentDate: DateTime!
              $startDate: DateTime!
              $endDate: DateTime!
            ) {
              account {
                byId(accountId: $accountId) {
                  id
                  name
                  subscription {
                    id
                    ...SubscriptionDetailsFragment
                  }
                  billingPeriod(date: $currentDate) {
                    id
                    ...BillingPeriodFragment
                  }
                  usageMetrics {
                    MEDIUM_ANDROID_BUILDS: metricsForServiceMetric(
                      serviceMetric: BUILDS
                      granularity: TOTAL
                      timespan: { start: $startDate, end: $endDate }
                      filterParams: {
                        platform: "android"
                        billingResourceClass: ["medium"]
                        status: ["finished", "errored"]
                      }
                    ) {
                      id
                      ...AccountUsageMetricFragment
                    }
                    LARGE_ANDROID_BUILDS: metricsForServiceMetric(
                      serviceMetric: BUILDS
                      granularity: TOTAL
                      timespan: { start: $startDate, end: $endDate }
                      filterParams: {
                        platform: "android"
                        billingResourceClass: ["large"]
                        status: ["finished", "errored"]
                      }
                    ) {
                      id
                      ...AccountUsageMetricFragment
                    }
                    MEDIUM_IOS_BUILDS: metricsForServiceMetric(
                      serviceMetric: BUILDS
                      granularity: TOTAL
                      timespan: { start: $startDate, end: $endDate }
                      filterParams: {
                        platform: "ios"
                        billingResourceClass: ["medium"]
                        status: ["finished", "errored"]
                      }
                    ) {
                      id
                      ...AccountUsageMetricFragment
                    }
                    LARGE_IOS_BUILDS: metricsForServiceMetric(
                      serviceMetric: BUILDS
                      granularity: TOTAL
                      timespan: { start: $startDate, end: $endDate }
                      filterParams: {
                        platform: "ios"
                        billingResourceClass: ["large"]
                        status: ["finished", "errored"]
                      }
                    ) {
                      id
                      ...AccountUsageMetricFragment
                    }
                    EAS_BUILD: byBillingPeriod(date: $currentDate, service: BUILDS) {
                      id
                      ...UsageMetricTotalFragment
                    }
                    EAS_UPDATE: byBillingPeriod(date: $currentDate, service: UPDATES) {
                      id
                      ...UsageMetricTotalFragment
                    }
                  }
                }
              }
            }
            ${print(SubscriptionDetailsFragmentNode)}
            ${print(BillingPeriodFragmentNode)}
            ${print(AccountUsageMetricFragmentNode)}
            ${print(UsageMetricTotalFragmentNode)}
          `,
          {
            accountId,
            currentDate: currentDate.toISOString(),
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
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

  async getBillingPeriodAsync(
    graphqlClient: ExpoGraphqlClient,
    accountId: string,
    currentDate: Date
  ): Promise<{
    start: Date;
    end: Date;
  }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{
          account: {
            byId: {
              id: string;
              name: string;
              billingPeriod: { id: string; start: string; end: string; anchor: string };
            } | null;
          };
        }>(
          gql`
            query AccountBillingPeriod($accountId: String!, $currentDate: DateTime!) {
              account {
                byId(accountId: $accountId) {
                  id
                  name
                  billingPeriod(date: $currentDate) {
                    id
                    ...BillingPeriodFragment
                  }
                }
              }
            }
            ${print(BillingPeriodFragmentNode)}
          `,
          { accountId, currentDate: currentDate.toISOString() },
          {
            additionalTypenames: ['Account', 'BillingPeriod'],
          }
        )
        .toPromise()
    );
    const { start, end } = data.account.byId?.billingPeriod ?? {};
    if (!start || !end) {
      throw new Error('Billing period data not found');
    }
    return {
      start: new Date(start),
      end: new Date(end),
    };
  },
};
