import gql from 'graphql-tag';

export const AccountUpdatesUsageFragmentNode = gql`
  fragment AccountUpdatesUsageFragment on Account {
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
`;
