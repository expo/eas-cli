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

const SUBMISSION_ARCHIVE_QUERY = graphql(`
  query DownloadSubmissionArchiveQuery($submissionId: ID!) {
    submissions {
      byId(submissionId: $submissionId) {
        id
        archiveUrl
      }
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
    ],
    outputProviders: [BuildStepOutput.createProvider({ id: 'artifact_path', required: true })],
    fn: async (stepsCtx, { inputs, outputs }) => {
      const submissionId = z.string().uuid().parse(inputs.submission_id.value);
      stepsCtx.logger.info(`Downloading archive for submission ${submissionId}...`);
      const result = await ctx.graphqlClient
        .query(SUBMISSION_ARCHIVE_QUERY, { submissionId }, { requestPolicy: 'network-only' })
        .toPromise();
      if (result.error) {
        const message = `Could not fetch submission archive: ${result.error.message}`;
        throw result.error.networkError || result.error.response?.status >= 500
          ? new SystemError(message, { cause: result.error })
          : new UserError('EAS_SUBMISSION_ARCHIVE_FETCH_FAILED', message, { cause: result.error });
      }
      const applicationArchiveUrl = result.data?.submissions.byId.archiveUrl;
      if (!applicationArchiveUrl) {
        throw new UserError(
          'EAS_SUBMISSION_ARCHIVE_MISSING',
          'This submission has no downloadable archive. Submit the IPA file or URL again.'
        );
      }
      const { artifactPath } = await downloadBuildAsync({
        logger: stepsCtx.logger,
        graphqlClient: ctx.graphqlClient,
        applicationArchiveUrl,
        robotAccessToken: null,
        extensions: ['ipa'],
      });
      outputs.artifact_path.set(artifactPath);
    },
  });
}
