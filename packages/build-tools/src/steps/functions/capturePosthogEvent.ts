import { UserError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';

import { PosthogClient } from '../utils/PosthogClient';
import { PosthogUtils } from '../utils/PosthogUtils';

export function createCapturePosthogEventFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'posthog_capture_event',
    name: 'Capture PostHog event',
    __metricsId: 'eas/posthog_capture_event',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'event',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: true,
      }),
      BuildStepInput.createProvider({
        id: 'distinct_id',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'properties',
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'api_key',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'host',
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
      const event = inputs.event.value as string;

      const client = PosthogClient.forIngestion({
        apiKeyOverride: inputs.api_key.value as string | undefined,
        hostOverride: inputs.host.value as string | undefined,
        env,
      });
      if (!client) {
        PosthogUtils.failOrLogError({
          logger,
          ignoreError,
          error: new UserError(
            'EAS_POSTHOG_MISSING_API_KEY',
            'PostHog API key not provided. Set the "api_key" input or the EXPO_PUBLIC_POSTHOG_API_KEY environment variable.'
          ),
        });
        return;
      }

      logger.info(`Sending PostHog event "${event}"`);
      try {
        await client.captureEventAsync({
          event,
          distinctId: inputs.distinct_id.value as string | undefined,
          properties: inputs.properties.value as Record<string, unknown> | undefined,
        });
      } catch (error) {
        PosthogUtils.failOrLogError({ logger, ignoreError, error });
        return;
      }
      logger.info(`Sent PostHog event "${event}"`);
    },
  });
}
