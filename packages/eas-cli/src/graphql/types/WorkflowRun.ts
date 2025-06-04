import gql from 'graphql-tag';

export const WorkflowRunFragmentNode = gql`
  fragment WorkflowRunFragment on WorkflowRun {
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
`;
