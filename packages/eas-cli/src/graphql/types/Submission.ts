import gql from 'graphql-tag';

export const SubmissionFragmentNode = gql`
  fragment SubmissionFragment on Submission {
    id
    status
    platform
    app {
      id
      name
      slug
      ownerAccount {
        id
        name
      }
    }
    androidConfig {
      applicationIdentifier
      track
      releaseStatus
      rollout
    }
    iosConfig {
      ascAppIdentifier
      appleIdUsername
    }
    error {
      errorCode
      message
    }
    logFiles
  }
`;
