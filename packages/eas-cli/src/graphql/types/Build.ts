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
    fingerprint {
      id
      hash
    }
    initiatingActor {
      __typename
      id
      displayName
    }
    logFileUrls
    app {
      __typename
      id
      name
      slug
      ownerAccount {
        id
        name
      }
    }
    updateChannel {
      id
      name
    }
    distribution
    iosEnterpriseProvisioning
    buildProfile
    appIdentifier
    sdkVersion
    appVersion
    appBuildVersion
    runtime {
      id
      version
    }
    gitCommitHash
    gitCommitMessage
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
    submissionsPaginated(first: 100) {
      edges {
        node {
          id
          ...SubmissionFragment
        }
      }
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
