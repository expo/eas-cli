import gql from 'graphql-tag';

export const FingerprintFragmentNode = gql`
  fragment FingerprintFragment on Fingerprint {
    id
    hash
    debugInfoUrl
  }
`;
