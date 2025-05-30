import gql from 'graphql-tag';

export const WorkflowRunsFragmentNode = gql`
  fragment WorkflowRunsFragment on Workflow {
    id
    runs: runsPaginated(last: $limit) {
      edges {
        node {
          id
          status
          gitCommitMessage
          gitCommitHash
          createdAt
          updatedAt
          workflow {
            id
            name
            fileName
          }
        }
      }
    }
  }
`;
