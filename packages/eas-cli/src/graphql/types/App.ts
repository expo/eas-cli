import gql from 'graphql-tag';

import { AccountFragmentNode } from './Account';

export const AppFragmentNode = gql`
  fragment AppFragment on App {
    id
    fullName
    slug
    ownerAccount {
      id
      name
      ...AccountFragment
    }
  }
  ${AccountFragmentNode}
`;
