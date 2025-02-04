import { print } from 'graphql';
import gql from 'graphql-tag';

import { FingerprintFragmentNode } from './Fingerprint';
import { SubmissionFragmentNode } from './Submission';

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
      applicationArchiveUrl
      buildArtifactsUrl
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
    distribution
    iosEnterpriseProvisioning
    buildProfile
    sdkVersion
    appVersion
    appBuildVersion
    runtimeVersion
    gitCommitHash
    gitCommitMessage
    initialQueuePosition
    queuePosition
    estimatedWaitTimeLeftSeconds
    priority
    createdAt
    updatedAt
    message
    completedAt
    expirationDate
    isForIosSimulator
    metrics {
      buildWaitTime
      buildQueueTime
      buildDuration
    }
  }
`;

export const BuildFragmentWithSubmissionsNode = gql`
  ${print(SubmissionFragmentNode)}
  ${print(BuildFragmentNode)}

  fragment BuildWithSubmissionsFragment on Build {
    id
    ...BuildFragment
    submissions {
      id
      ...SubmissionFragment
    }
  }
`;

export const BuildFragmentWithFingerprintNode = gql`
  ${print(FingerprintFragmentNode)}
  ${print(BuildFragmentNode)}

  fragment BuildWithFingerprintFragment on Build {
    id
    ...BuildFragment
    fingerprint {
      id
      ...FingerprintFragment
    }
  }
`;
