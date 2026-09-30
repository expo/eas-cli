import { print } from 'graphql';
import gql from 'graphql-tag';
import nullthrows from 'nullthrows';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  CancelSubmissionMutation,
  CancelSubmissionMutationVariables,
  CreateAndroidSubmissionInput,
  CreateAndroidSubmissionMutation,
  CreateAndroidSubmissionMutationVariables,
  CreateIosSubmissionInput,
  CreateIosSubmissionMutation,
  CreateIosSubmissionMutationVariables,
  RetrySubmissionMutation,
  RetrySubmissionMutationVariables,
  Submission,
  SubmissionFragment,
} from '../generated';
import { SubmissionFragmentNode } from '../types/Submission';

export const SubmissionMutation = {
  async createAndroidSubmissionAsync(
    graphqlClient: ExpoGraphqlClient,
    input: CreateAndroidSubmissionInput
  ): Promise<SubmissionFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAndroidSubmissionMutation, CreateAndroidSubmissionMutationVariables>(
          gql`
            mutation CreateAndroidSubmissionMutation(
              $appId: ID!
              $config: AndroidSubmissionConfigInput!
              $submittedBuildId: ID
              $archiveSource: SubmissionArchiveSourceInput
            ) {
              submission {
                createAndroidSubmission(
                  input: {
                    appId: $appId
                    config: $config
                    submittedBuildId: $submittedBuildId
                    archiveSource: $archiveSource
                  }
                ) {
                  submission {
                    id
                    ...SubmissionFragment
                  }
                }
              }
            }
            ${print(SubmissionFragmentNode)}
          `,
          input
        )
        .toPromise()
    );
    return nullthrows(data.submission.createAndroidSubmission.submission);
  },
  async createIosSubmissionAsync(
    graphqlClient: ExpoGraphqlClient,
    input: CreateIosSubmissionInput
  ): Promise<SubmissionFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateIosSubmissionMutation, CreateIosSubmissionMutationVariables>(
          gql`
            mutation CreateIosSubmissionMutation(
              $appId: ID!
              $config: IosSubmissionConfigInput!
              $submittedBuildId: ID
              $archiveSource: SubmissionArchiveSourceInput
            ) {
              submission {
                createIosSubmission(
                  input: {
                    appId: $appId
                    config: $config
                    submittedBuildId: $submittedBuildId
                    archiveSource: $archiveSource
                  }
                ) {
                  submission {
                    id
                    ...SubmissionFragment
                  }
                }
              }
            }
            ${print(SubmissionFragmentNode)}
          `,
          input
        )
        .toPromise()
    );
    return nullthrows(data.submission.createIosSubmission.submission);
  },
  async cancelSubmissionAsync(
    graphqlClient: ExpoGraphqlClient,
    submissionId: string
  ): Promise<Pick<Submission, 'id' | 'status'>> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CancelSubmissionMutation, CancelSubmissionMutationVariables>(
          gql`
            mutation CancelSubmissionMutation($submissionId: ID!) {
              submission {
                cancelSubmission(submissionId: $submissionId) {
                  id
                  status
                }
              }
            }
          `,
          { submissionId }
        )
        .toPromise()
    );
    return data.submission.cancelSubmission;
  },
  async retrySubmissionAsync(
    graphqlClient: ExpoGraphqlClient,
    parentSubmissionId: string
  ): Promise<SubmissionFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<RetrySubmissionMutation, RetrySubmissionMutationVariables>(
          gql`
            mutation RetrySubmissionMutation($parentSubmissionId: ID!) {
              submission {
                retrySubmission(parentSubmissionId: $parentSubmissionId) {
                  submission {
                    id
                    ...SubmissionFragment
                  }
                }
              }
            }
            ${print(SubmissionFragmentNode)}
          `,
          { parentSubmissionId }
        )
        .toPromise()
    );
    return nullthrows(data.submission.retrySubmission.submission);
  },
};
