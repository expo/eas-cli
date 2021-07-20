import { JSONObject } from '@expo/json-file';
import gql from 'graphql-tag';
import nullthrows from 'nullthrows';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import {
  AppPlatform,
  CreateSubmissionMutation,
  CreateSubmissionMutationVariables,
  Submission,
} from '../generated';

interface CreateSubmissionResult {
  submission: Pick<Submission, 'id'>;
}

export const SubmissionMutation = {
  async createSubmissionAsync(input: {
    appId: string;
    submittedBuildId?: string;
    platform: AppPlatform;
    config: JSONObject;
  }): Promise<CreateSubmissionResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateSubmissionMutation, CreateSubmissionMutationVariables>(
          gql`
            mutation CreateSubmissionMutation(
              $appId: ID!
              $platform: AppPlatform!
              $config: JSONObject!
              $submittedBuildId: ID
            ) {
              submission {
                createSubmission(
                  input: {
                    appId: $appId
                    platform: $platform
                    config: $config
                    submittedBuildId: $submittedBuildId
                  }
                ) {
                  submission {
                    id
                  }
                }
              }
            }
          `,
          input
        )
        .toPromise()
    );
    return nullthrows(data.submission?.createSubmission);
  },
};
