import gql from 'graphql-tag';

export const UpdateBranchFragmentNode = gql`
  fragment UpdateBranchFragment on UpdateBranch {
    id
    name
    updates(offset: 0, limit: 10) {
      id
      actor {
        __typename
        id
        ... on User {
          username
        }
        ... on Robot {
          firstName
        }
      }
      createdAt
      message
      runtimeVersion
      group
      platform
    }
  }
`;
