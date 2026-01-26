/* eslint-disable graphql/required-fields */
import { print } from 'graphql';
import gql from 'graphql-tag';

export const AccountFragmentNode = gql`
  fragment AccountFragment on Account {
    id
    name
    ownerUserActor {
      id
      username
    }
    users {
      actor {
        id
      }
      role
    }
  }
`;

export const InvoiceLineItemFragmentNode = gql`
  fragment InvoiceLineItemFragment on InvoiceLineItem {
    id
    description
    amount
    period {
      start
      end
    }
  }
`;

export const InvoiceFragmentNode = gql`
  ${print(InvoiceLineItemFragmentNode)}

  fragment InvoiceFragment on Invoice {
    id
    total
    lineItems {
      ...InvoiceLineItemFragment
    }
  }
`;

export const ConcurrenciesFragmentNode = gql`
  fragment ConcurrenciesFragment on Concurrencies {
    total
    android
    ios
  }
`;

export const AddonDetailsFragmentNode = gql`
  fragment AddonDetailsFragment on AddonDetails {
    id
    name
    quantity
  }
`;

export const SubscriptionDetailsFragmentNode = gql`
  ${print(ConcurrenciesFragmentNode)}
  ${print(AddonDetailsFragmentNode)}
  ${print(InvoiceFragmentNode)}

  fragment SubscriptionDetailsFragment on SubscriptionDetails {
    id
    name
    status
    nextInvoice
    nextInvoiceAmountDueCents
    recurringCents
    price
    concurrencies {
      ...ConcurrenciesFragment
    }
    addons {
      ...AddonDetailsFragment
    }
    upcomingInvoice {
      ...InvoiceFragment
    }
  }
`;

export const BillingPeriodFragmentNode = gql`
  fragment BillingPeriodFragment on BillingPeriod {
    id
    start
    end
    anchor
  }
`;

export const EstimatedUsagePlatformBreakdownFragmentNode = gql`
  fragment EstimatedUsagePlatformBreakdownFragment on EstimatedUsagePlatformBreakdown {
    ios {
      value
      limit
    }
    android {
      value
      limit
    }
  }
`;

export const EstimatedUsageFragmentNode = gql`
  ${print(EstimatedUsagePlatformBreakdownFragmentNode)}

  fragment EstimatedUsageFragment on EstimatedUsage {
    id
    service
    serviceMetric
    metricType
    value
    limit
    platformBreakdown {
      ...EstimatedUsagePlatformBreakdownFragment
    }
  }
`;

export const EstimatedOverageAndCostFragmentNode = gql`
  fragment EstimatedOverageAndCostFragment on EstimatedOverageAndCost {
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
`;

export const UsageMetricTotalFragmentNode = gql`
  ${print(BillingPeriodFragmentNode)}
  ${print(EstimatedUsageFragmentNode)}
  ${print(EstimatedOverageAndCostFragmentNode)}

  fragment UsageMetricTotalFragment on UsageMetricTotal {
    id
    billingPeriod {
      ...BillingPeriodFragment
    }
    planMetrics {
      ...EstimatedUsageFragment
    }
    overageMetrics {
      ...EstimatedOverageAndCostFragment
    }
    totalCost
  }
`;

export const AccountUsageMetricFragmentNode = gql`
  fragment AccountUsageMetricFragment on AccountUsageMetric {
    id
    serviceMetric
    metricType
    value
  }
`;
