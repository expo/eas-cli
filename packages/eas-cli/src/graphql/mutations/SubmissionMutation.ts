import { print } from 'graphql';
import { gql } from 'graphql-tag';

import { nullthrows } from '../../utils/nullthrows.js';
import { graphqlClient, withErrorHandlingAsync } from '../client.js';
import {
  CreateAndroidSubmissionInput,
  CreateAndroidSubmissionMutation,
  CreateAndroidSubmissionMutationVariables,
  CreateIosSubmissionInput,
  CreateIosSubmissionMutation,
  CreateIosSubmissionMutationVariables,
  SubmissionFragment,
} from '../generated.js';
import { SubmissionFragmentNode } from '../types/Submission.js';

export const SubmissionMutation = {
  async createAndroidSubmissionAsync(
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
            ) {
              submission {
                createAndroidSubmission(
                  input: { appId: $appId, config: $config, submittedBuildId: $submittedBuildId }
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
  async createIosSubmissionAsync(input: CreateIosSubmissionInput): Promise<SubmissionFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateIosSubmissionMutation, CreateIosSubmissionMutationVariables>(
          gql`
            mutation CreateIosSubmissionMutation(
              $appId: ID!
              $config: IosSubmissionConfigInput!
              $submittedBuildId: ID
            ) {
              submission {
                createIosSubmission(
                  input: { appId: $appId, config: $config, submittedBuildId: $submittedBuildId }
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
};
