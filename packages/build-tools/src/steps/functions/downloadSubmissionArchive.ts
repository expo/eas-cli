import { SystemError, UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import { gql } from '@urql/core';
import { z } from 'zod';

import { downloadBuildAsync } from './downloadBuild';
import { CustomBuildContext } from '../../customBuildContext';
import { graphqlAbortContext } from '../../utils/graphqlAbort';

const CREATE_ARCHIVE_DOWNLOAD_URL = gql`
  mutation GenerateSubmissionArchiveDownloadUrl($submissionId: ID!) {
    submission {
      generateSubmissionArchiveDownloadUrl(submissionId: $submissionId)
    }
  }
`;

export function createDownloadSubmissionArchiveFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'download_submission_archive',
    name: 'Download submission archive',
    __metricsId: 'eas/download_submission_archive',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'submission_id',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'extensions',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        defaultValue: ['apk', 'aab', 'ipa'],
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'artifact_path',
        required: true,
      }),
    ],
    fn: async (stepsCtx, { inputs, outputs, signal }) => {
      const { submissionId, extensions } = z
        .object({
          submissionId: z.string().uuid(),
          extensions: z.array(z.string()),
        })
        .parse({
          submissionId: inputs.submission_id.value,
          extensions: inputs.extensions.value,
        });

      stepsCtx.logger.info(`Downloading archive for submission ${submissionId}...`);

      signal?.throwIfAborted();

      const result = await ctx.graphqlClient
        .mutation<{ submission: { generateSubmissionArchiveDownloadUrl: string } }>(
          CREATE_ARCHIVE_DOWNLOAD_URL,
          { submissionId },
          graphqlAbortContext(signal)
        )
        .toPromise();

      signal?.throwIfAborted();

      if (result.error) {
        throw result.error.networkError || result.error.response?.status >= 500
          ? new SystemError('Could not request the submission archive. Try again later.', {
              cause: result.error,
            })
          : new UserError(
              'EAS_SUBMISSION_ARCHIVE_FETCH_FAILED',
              'Could not request the submission archive. Check your project access and the submission archive.',
              { cause: result.error }
            );
      }

      const applicationArchiveUrl = result.data?.submission.generateSubmissionArchiveDownloadUrl;

      if (!applicationArchiveUrl) {
        throw new SystemError(
          'The server did not return a submission archive URL. Try again later.'
        );
      }

      const { artifactPath } = await downloadBuildAsync({
        logger: stepsCtx.logger,
        graphqlClient: ctx.graphqlClient,
        applicationArchiveUrl,
        robotAccessToken: null,
        extensions,
        signal,
      });

      outputs.artifact_path.set(artifactPath);
    },
  });
}
