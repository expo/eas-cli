import { gql } from 'graphql-tag';

export const BuildFragmentNode = gql`
  fragment BuildFragment on Build {
    id
    status
    platform
    error {
      errorCode
      message
      docsUrl
    }
    artifacts {
      buildUrl
      xcodeBuildLogsUrl
    }
    initiatingActor {
      __typename
      id
      displayName
    }
    project {
      __typename
      id
      name
      slug
      ... on App {
        ownerAccount {
          id
          name
        }
      }
    }
    channel
    releaseChannel
    distribution
    iosEnterpriseProvisioning
    buildProfile
    sdkVersion
    appVersion
    appBuildVersion
    runtimeVersion
    gitCommitHash
    initialQueuePosition
    queuePosition
    estimatedWaitTimeLeftSeconds
    priority
    createdAt
    updatedAt
  }
`;
