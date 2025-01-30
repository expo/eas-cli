import gql from 'graphql-tag';

export const FingerprintFragmentNode = gql`
  fragment FingerprintFragment on Fingerprint {
    id
    hash
    debugInfoUrl
    builds(first: 1) {
      edges {
        node {
          id
          ... on Build {
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
