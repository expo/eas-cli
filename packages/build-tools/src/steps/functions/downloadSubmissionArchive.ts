import { SystemError, UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import { graphql } from 'gql.tada';
import { z } from 'zod';

import { downloadBuildAsync } from './downloadBuild';
import { CustomBuildContext } from '../../customBuildContext';
import { graphqlAbortContext } from '../../utils/graphqlAbort';
import { promiseRetryWithCondition } from '../../utils/promiseRetryWithCondition';

const CREATE_ARCHIVE_DOWNLOAD_URL = graphql(`
  mutation GenerateSubmissionArchiveDownloadUrl($submissionId: ID!) {
    submission {
      generateSubmissionArchiveDownloadUrl(submissionId: $submissionId)
    }
  }
`);

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

      const applicationArchiveUrl = await promiseRetryWithCondition(
        async () => {
          signal?.throwIfAborted();

          const result = await ctx.graphqlClient
            .mutation(CREATE_ARCHIVE_DOWNLOAD_URL, { submissionId }, graphqlAbortContext(signal))
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

          const url = result.data?.submission.generateSubmissionArchiveDownloadUrl;

          if (!url) {
            throw new SystemError(
              'The server did not return a submission archive URL. Try again later.'
            );
          }
          return url;
        },
        error => !signal?.aborted && error instanceof SystemError,
        { retries: 3, minTimeout: 1000, maxTimeout: 1000 },
        ({ attemptNumber, maxAttemptsCount }) => {
          stepsCtx.logger.info(
            `Retrying submission archive URL request (${attemptNumber}/${maxAttemptsCount})...`
          );
        }
      )();

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
