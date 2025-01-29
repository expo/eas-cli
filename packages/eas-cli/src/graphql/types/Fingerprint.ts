import gql from 'graphql-tag';

export const FingerprintFragmentNode = gql`
  fragment FingerprintFragment on Fingerprint {
    id
    hash
    debugInfoUrl
    builds(first: 1) {
      edges {
        node {
          ... on Build {
            id
            platform
          }
        }
      }
    }
    updates(first: 1) {
      edges {
        node {
          id
          platform
        }
      }
    }
  }
`;
