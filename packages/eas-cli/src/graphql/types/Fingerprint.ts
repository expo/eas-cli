import gql from 'graphql-tag';

export const FingerprintFragmentNode = gql`
  fragment FingerprintFragment on Fingerprint {
    id
    hash
    debugInfoUrl
    builds(first: 1) {
      edges {
        node {
          ...BuildFragment
        }
      }
    }
    updates(first: 1) {
      edges {
        node {
          ...UpdateFragment
        }
      }
    }
  }
`;
