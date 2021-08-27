import gql from 'graphql-tag';

export const SubmissionFragmentNode = gql`
  fragment SubmissionFragment on Submission {
    id
    status
    platform
    app {
      id
      name
      ownerAccount {
        id
        name
      }
    }
    error {
      errorCode
      message
    }
    logsUrl
  }
`;
