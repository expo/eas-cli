import gql from 'graphql-tag';

export const WorkflowRunFragmentNode = gql`
  fragment WorkflowRunFragment on WorkflowRun {
    id
    status
    gitCommitMessage
    gitCommitHash
    requestedGitRef
    actor {
      id
      __typename
      ... on UserActor {
        username
      }
      ... on Robot {
        firstName
      }
    }
    triggeringLabelName
    triggerEventType
    triggeringSchedule
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
