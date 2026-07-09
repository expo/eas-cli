import { UserError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';

import { MISSING_POSTHOG_API_TARGET_MESSAGE, PosthogClient } from '../utils/PosthogClient';
import { PosthogUtils } from '../utils/PosthogUtils';

export function createPosthogAnnotationFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'posthog_annotation',
    name: 'Create a PostHog annotation',
    __metricsId: 'eas/posthog_annotation',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'content',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: true,
      }),
      BuildStepInput.createProvider({
        id: 'date_marker',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'api_key',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'project_id',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'ignore_error',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
    ],
    fn: async (stepCtx, { inputs, env }) => {
      const { logger } = stepCtx;
      const ignoreError = Boolean(inputs.ignore_error.value);

      const client = PosthogClient.fromEnv({
        apiKeyOverride: inputs.api_key.value as string | undefined,
        projectIdOverride: inputs.project_id.value as string | undefined,
        env,
      });
      if (!client) {
        PosthogUtils.failOrLogError({
          logger,
          ignoreError,
          error: new UserError(
            'EAS_POSTHOG_MISSING_CREDENTIALS',
            MISSING_POSTHOG_API_TARGET_MESSAGE
          ),
        });
        return;
      }

      const content = inputs.content.value as string;
      const dateMarker =
        (inputs.date_marker.value as string | undefined) ?? new Date().toISOString();

      logger.info(`Creating PostHog annotation "${content}"`);
      try {
        await client.requestAsync('POST', '/annotations/', {
          action: 'Creating the PostHog annotation',
          forbiddenScope: 'annotation:write',
          body: { content, date_marker: dateMarker },
        });
      } catch (error) {
        PosthogUtils.failOrLogError({ logger, ignoreError, error });
        return;
      }

      logger.info('Created PostHog annotation');
    },
  });
}
