import gql from 'graphql-tag';

// TODO: add rollout here
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
    }
    iosConfig {
      ascAppIdentifier
      appleIdUsername
    }
    error {
      errorCode
      message
    }
    logsUrl
  }
`;
