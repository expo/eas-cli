import gql from 'graphql-tag';

export const BuildFragmentNode = gql`
  fragment BuildFragment on Build {
    id
    status
    platform
    error {
      errorCode
      message
    }
    artifacts {
      buildUrl
      xcodeBuildLogsUrl
    }
    initiatingActor {
      __typename
      id
      ... on User {
        username
      }
      ... on Robot {
        firstName
      }
    }
    project {
      __typename
      id
      ... on App {
        ownerAccount {
          id
          name
        }
      }
    }
    createdAt
    updatedAt
  }
`;
