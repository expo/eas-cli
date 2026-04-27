import gql from 'graphql-tag';

export const AppObserveTimeSeriesFragmentNode = gql`
  fragment AppObserveTimeSeriesFragment on AppObserveTimeSeries {
    appVersionMarkers {
      ...AppObserveAppVersionFragment
    }
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
`;

export const AppObserveCustomEventFragmentNode = gql`
  fragment AppObserveCustomEventFragment on AppObserveCustomEvent {
    id
    eventName
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

export const AppObserveEventFragmentNode = gql`
  fragment AppObserveEventFragment on AppObserveEvent {
    id
    metricName
    metricValue
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
