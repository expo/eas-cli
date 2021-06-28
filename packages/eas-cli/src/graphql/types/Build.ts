import gql from 'graphql-tag';

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
      shortBuildUrl
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
    releaseChannel
    distribution
    createdAt
    updatedAt
  }
`;
