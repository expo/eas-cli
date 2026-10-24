import { UserError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import path from 'node:path';
import { z } from 'zod';

import { AscApiClient } from '../utils/ios/AscApiClient';
import { AscApiUtils } from '../utils/ios/AscApiUtils';

export function createSubmitTestFlightBetaReviewBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'submit_testflight_beta_review',
    name: 'Submit for TestFlight beta review',
    __metricsId: 'eas/submit_testflight_beta_review',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'asc_api_key_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'build_upload_id',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (ctx, { inputs }) => {
      const { ascApiKeyPath, buildUploadId } = z
        .object({ ascApiKeyPath: z.string(), buildUploadId: z.string() })
        .parse({
          ascApiKeyPath: inputs.asc_api_key_path.value,
          buildUploadId: inputs.build_upload_id.value,
        });
      const keyPath = path.resolve(ctx.workingDirectory, ascApiKeyPath);
      const key = await AscApiUtils.loadApiKeyAsync({ keyPath });
      const client = new AscApiClient({ key, logger: ctx.logger });
      const { data: upload } = await client.getAsync(
        '/v1/buildUploads/:id',
        {
          'fields[buildUploads]': ['state', 'build'],
          include: ['build'],
        },
        { id: buildUploadId }
      );
      const buildId = upload.relationships?.build?.data?.id;
      if (upload.attributes.state.state !== 'COMPLETE' || !buildId) {
        throw new UserError(
          'EAS_TESTFLIGHT_BUILD_NOT_READY',
          'The uploaded build is not ready for beta review. Run eas/wait_for_asc_build_processing before this step.'
        );
      }
      const { data } = await client.getAsync('/v1/builds/:id/buildBetaDetail', {}, { id: buildId });
      const reviewedStates = [
        'WAITING_FOR_BETA_REVIEW',
        'IN_BETA_REVIEW',
        'READY_FOR_BETA_TESTING',
        'IN_BETA_TESTING',
      ];
      if (reviewedStates.includes(data.attributes.externalBuildState ?? '')) {
        ctx.logger.info('This build is already in beta review or available for external testing.');
        return;
      }
      await client.postAsync('/v1/betaAppReviewSubmissions', {
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: { build: { data: { type: 'builds', id: buildId } } },
        },
      });
      ctx.logger.info('Build submitted for beta review.');
    },
  });
}
