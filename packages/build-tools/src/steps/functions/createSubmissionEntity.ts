import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { asyncResult } from '@expo/results';

import { retryOnDNSFailure } from '../../utils/retryOnDNSFailure';

export function createSubmissionEntityFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'create_submission_entity',
    name: 'Create Submission Entity',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'build_id',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: true,
      }),

      // AndroidSubmissionConfig
      BuildStepInput.createProvider({
        id: 'track',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'release_status',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'rollout',
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'changes_not_sent_for_review',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),

      // IosSubmissionConfig
      BuildStepInput.createProvider({
        id: 'apple_id_username',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'asc_app_identifier',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
    ],
    fn: async (stepsCtx, { inputs }) => {
      const robotAccessToken = stepsCtx.global.staticContext.job.secrets?.robotAccessToken;
      if (!robotAccessToken) {
        stepsCtx.logger.error('Failed to create submission entity: no robot access token found');
        return;
      }

      const buildId = inputs.build_id.value;
      if (!buildId) {
        stepsCtx.logger.error('Failed to create submission entity: no build ID provided');
        return;
      }

      const workflowJobId = stepsCtx.global.env.__WORKFLOW_JOB_ID;
      if (!workflowJobId) {
        stepsCtx.logger.error('Failed to create submission entity: no workflow job ID found');
        return;
      }

      // This is supposed to provide fallback for `''` -> `undefined`.
      // We _not_ want to use nullish coalescing.
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
      const track = inputs.track.value || undefined;
      const releaseStatus = inputs.release_status.value || undefined;
      const rollout = inputs.rollout.value || undefined;
      const changesNotSentForReview = inputs.changes_not_sent_for_review.value || undefined;

      const appleIdUsername = inputs.apple_id_username.value || undefined;
      const ascAppIdentifier = inputs.asc_app_identifier.value || undefined;
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

      try {
        const response = await retryOnDNSFailure(fetch)(
          new URL('/v2/app-store-submissions/', stepsCtx.global.staticContext.expoApiServerURL),
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${robotAccessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              workflowJobId,
              turtleBuildId: buildId,
              // We can pass mixed object here because the configs are disjoint.
              config: {
                // AndroidSubmissionConfig
                track,
                releaseStatus,
                rollout,
                changesNotSentForReview,

                // IosSubmissionConfig
                appleIdUsername,
                ascAppIdentifier,
              },
            }),
          }
        );

        if (!response.ok) {
          const textResult = await asyncResult(response.text());
          throw new Error(
            `Unexpected response from server (${response.status}): ${textResult.value}`
          );
        }

        const jsonResult = await asyncResult(response.json());
        if (!jsonResult.ok) {
          stepsCtx.logger.warn(
            `Submission created. Failed to parse response. ${jsonResult.reason}`
          );
          return;
        }

        const data = jsonResult.value.data;
        stepsCtx.logger.info(`Submission created:\n  ID: ${data.id}\n  URL: ${data.url}`);
      } catch (e) {
        stepsCtx.logger.error(`Failed to create submission entity. ${e}`);
      }
    },
  });
}
