import gql from 'graphql-tag';

export const UpdateFragmentNode = gql`
  fragment UpdateFragment on Update {
    id
    group
    message
    createdAt
    runtimeVersion
    platform
    manifestFragment
    manifestPermalink
    gitCommitHash
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
    branch {
      id
      name
    }
    codeSigningInfo {
      keyid
      sig
      alg
    }
  }
`;
