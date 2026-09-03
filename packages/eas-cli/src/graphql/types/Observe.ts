import gql from 'graphql-tag';

export const AppObserveUserEventFragmentNode = gql`
  fragment AppObserveUserEventFragment on AppObserveUserEvent {
    id
    name
    timestamp
    sessionId
    severityNumber
    severityText
    properties {
      key
      value
      type
    }
    appVersion
    appBuildNumber
    appUpdateId
    appEasBuildId
    deviceOs
    deviceOsVersion
    deviceModel
    environment
    easClientId
    countryCode
  }
`;

export const AppObserveErrorFragmentNode = gql`
  fragment AppObserveErrorFragment on AppObserveError {
    id
    timestamp
    sessionId
    severityNumber
    severityText
    type
    message
    source
    fingerprint
    isFatal
    properties {
      key
      value
      type
    }
    appVersion
    appBuildNumber
    appUpdateId
    appEasBuildId
    deviceOs
    deviceOsVersion
    deviceModel
    environment
    easClientId
    countryCode
  }
`;

export const AppObserveMetricFragmentNode = gql`
  fragment AppObserveMetricFragment on AppObserveMetric {
    id
    name
    value
    timestamp
    appVersion
    appBuildNumber
    appUpdateId
    deviceModel
    deviceOs
    deviceOsVersion
    countryCode
    sessionId
    easClientId
    customParams
    routeName
  }
`;

export const AppObserveErrorGroupFragmentNode = gql`
  fragment AppObserveErrorGroupFragment on AppObserveErrorGroup {
    fingerprint
    exceptionType
    exceptionMessage
    errorSource
    severity
    isFatal
    eventCount
    uniqueUserCount
    affectedSessionCount
    firstSeenAt
    lastSeenAt
    platforms
  }
`;

export const AppObserveAppVersionFragmentNode = gql`
  fragment AppObserveAppVersionFragment on AppObserveAppVersion {
    appVersion
    firstSeenAt
    eventCount
    uniqueUserCount
    buildNumbers {
      appBuildNumber
      firstSeenAt
      eventCount
      uniqueUserCount
      easBuilds {
        easBuildId
        firstSeenAt
        eventCount
        uniqueUserCount
      }
    }
    updates {
      appUpdateId
      firstSeenAt
      eventCount
      uniqueUserCount
      easBuilds {
        easBuildId
        firstSeenAt
        eventCount
        uniqueUserCount
      }
    }
    metrics {
      metricName
      eventCount
      statistics {
        min
        max
        median
        average
        p80
        p90
        p99
      }
    }
  }
`;
