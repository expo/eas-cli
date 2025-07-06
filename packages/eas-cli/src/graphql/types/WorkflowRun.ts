import gql from 'graphql-tag';

export const WorkflowRunFragmentNode = gql`
  fragment WorkflowRunFragment on WorkflowRun {
    id
    status
    gitCommitMessage
    gitCommitHash
    requestedGitRef
    createdAt
    updatedAt
    errors {
      title
      message
    }
    workflow {
      id
      name
      fileName
    }
  }
`;
