import gql from 'graphql-tag';

export const AppleAppIdentifierFragmentNode = gql`
  fragment AppleAppIdentifierFragment on AppleAppIdentifier {
    id
    bundleIdentifier
  }
`;
