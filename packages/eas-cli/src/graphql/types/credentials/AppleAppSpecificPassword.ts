import gql from 'graphql-tag';

export const AppleAppSpecificPasswordFragmentNode = gql`
  fragment AppleAppSpecificPasswordFragment on AppleAppSpecificPassword {
    id
    appleIdUsername
    passwordLabel
    updatedAt
  }
`;
