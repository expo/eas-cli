import { print } from 'graphql';
import gql from 'graphql-tag';

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
    releaseChannel
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
    resourceClass
    expirationDate
    isForIosSimulator
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
