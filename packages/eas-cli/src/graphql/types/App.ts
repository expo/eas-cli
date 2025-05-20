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

export const AppWorkflowsFragmentNode = gql`
  fragment AppWorkflowsFragment on App {
    id
    workflows {
      id
      name
      fileName
      createdAt
      updatedAt
    }
  }
`;

export const AppWorkflowRunsFragmentNode = gql`
  fragment AppWorkflowRunsFragment on App {
    id
    runs: workflowRunsPaginated(last: $limit) {
      edges {
        node {
          id
          status
          gitCommitMessage
          gitCommitHash
          createdAt
          workflow {
            id
            name
          }
        }
      }
    }
  }
`;
