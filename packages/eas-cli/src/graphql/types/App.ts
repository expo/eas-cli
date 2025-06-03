import gql from 'graphql-tag';

import { AccountFragmentNode } from './Account';

export const AppFragmentNode = gql`
  fragment AppFragment on App {
    id
    name
    fullName
    slug
    ownerAccount {
      id
      name
      ...AccountFragment
    }
    githubRepository {
      id
      metadata {
        githubRepoOwnerName
        githubRepoName
      }
    }
  }
  ${AccountFragmentNode}
`;
