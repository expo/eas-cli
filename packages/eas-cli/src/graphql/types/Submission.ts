import gql from 'graphql-tag';

export const SubmissionFragmentNode = gql`
  fragment SubmissionFragment on Submission {
    id
    status
    platform
    error {
      errorCode
      message
    }
    logsUrl
  }
`;
