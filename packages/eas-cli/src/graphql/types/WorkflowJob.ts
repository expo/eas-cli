import gql from 'graphql-tag';

import { BuildFragmentNode } from './Build';

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
      artifacts {
        id
        name
        contentType
        fileSizeBytes
        filename
        downloadUrl
      }
      errors {
        errorCode
        message
      }
    }
    turtleBuild {
      id
      ...BuildFragment
    }
    outputs
    errors {
      title
      message
    }
    createdAt
    updatedAt
  }
  ${BuildFragmentNode}
`;
