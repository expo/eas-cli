import gql from 'graphql-tag';

export const AppleAppIdentifierFragmentDoc = gql`
  fragment AppleAppIdentifierFragment on AppleAppIdentifier {
    id
    bundleIdentifier
  }
`;
