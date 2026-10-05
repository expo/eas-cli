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
    ],
    outputProviders: [BuildStepOutput.createProvider({ id: 'artifact_path', required: true })],
    fn: async (stepsCtx, { inputs, outputs, signal }) => {
      const submissionId = z.string().uuid().parse(inputs.submission_id.value);
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
        // Do not include response details, which can contain a signed URL.
        throw result.error.networkError || result.error.response?.status >= 500
          ? new SystemError('Could not request the submission archive. Try again later.')
          : new UserError(
              'EAS_SUBMISSION_ARCHIVE_FETCH_FAILED',
              'Could not request the submission archive. Check your project access and submit the IPA file or URL again.'
            );
      }
      const applicationArchiveUrl = result.data?.submission.generateSubmissionArchiveDownloadUrl;
      if (!applicationArchiveUrl) {
        throw new SystemError(
          'The server did not return a submission archive URL. Try again later.'
        );
      }
      try {
        const { artifactPath } = await downloadBuildAsync({
          logger: stepsCtx.logger,
          graphqlClient: ctx.graphqlClient,
          applicationArchiveUrl,
          robotAccessToken: null,
          extensions: ['ipa'],
          signal,
        });
        outputs.artifact_path.set(artifactPath);
      } catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.replaceAll(applicationArchiveUrl, '[archive URL]'));
      }
    },
  });
}
