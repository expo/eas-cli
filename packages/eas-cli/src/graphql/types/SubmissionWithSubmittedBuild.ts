import { print } from 'graphql';
import gql from 'graphql-tag';

import { BuildFragmentNode } from './Build';
import { SubmissionFragmentNode } from './Submission';

export const SubmissionWithSubmittedBuildFragmentNode = gql`
  ${print(BuildFragmentNode)}
  ${print(SubmissionFragmentNode)}

  fragment SubmissionWithSubmittedBuildFragment on Submission {
    id
    ...SubmissionFragment
    createdAt
    completedAt
    canRetry
    maxRetryTimeMinutes
    submittedBuild {
      id
      ...BuildFragment
    }
  }
`;
