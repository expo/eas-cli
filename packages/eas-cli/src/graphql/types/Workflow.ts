import gql from 'graphql-tag';

export const WorkflowFragmentNode = gql`
  fragment WorkflowFragment on Workflow {
    id
    name
    fileName
    createdAt
    updatedAt
  }
`;
