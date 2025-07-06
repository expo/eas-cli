import gql from 'graphql-tag';

export const WorkflowJobFragmentNode = gql`
  fragment WorkflowJobFragment on WorkflowJob {
    id
    key
    name
    status
    workflowRun {
      id
    }
    type
    turtleJobRun {
      id
      logFileUrls
      errors {
        errorCode
        message
      }
    }
    outputs
    errors {
      title
      message
    }
    createdAt
    updatedAt
  }
`;
