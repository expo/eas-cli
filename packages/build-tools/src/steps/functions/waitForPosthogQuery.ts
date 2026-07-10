import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';

import {
  PosthogClient,
  PosthogRetryableError,
  missingPosthogCredentialsError,
} from '../utils/PosthogClient';
import { PosthogUtils } from '../utils/PosthogUtils';

export function createWaitForPosthogQueryFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'posthog_wait_for_query',
    name: 'Wait for a PostHog query',
    __metricsId: 'eas/posthog_wait_for_query',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'query',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: true,
      }),
      BuildStepInput.createProvider({
        id: 'timeout_seconds',
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
        required: false,
        defaultValue: PosthogUtils.DEFAULT_POLL_TIMEOUT_SECONDS,
      }),
      BuildStepInput.createProvider({
        id: 'interval_seconds',
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
        required: false,
        defaultValue: PosthogUtils.DEFAULT_POLL_INTERVAL_SECONDS,
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
    ],
    fn: async (stepCtx, { inputs, env, signal }) => {
      const { logger } = stepCtx;

      const timeoutSeconds = inputs.timeout_seconds.value as number;
      const intervalSeconds = inputs.interval_seconds.value as number;
      PosthogUtils.assertPollBoundsPositive({
        timeoutSeconds,
        intervalSeconds,
        errorCode: 'EAS_POSTHOG_QUERY_INVALID_INTERVAL',
      });

      const result = PosthogClient.fromEnv({
        apiKeyOverride: inputs.api_key.value as string | undefined,
        projectIdOverride: inputs.project_id.value as string | undefined,
        env,
      });
      if (!result.client) {
        throw missingPosthogCredentialsError(result.missing);
      }
      const client = result.client;

      await waitForPosthogQueryAsync({
        logger,
        client,
        query: inputs.query.value as string,
        timeoutSeconds,
        intervalSeconds,
        signal,
      });
    },
  });
}

async function waitForPosthogQueryAsync({
  logger,
  client,
  query,
  timeoutSeconds,
  intervalSeconds,
  signal,
}: {
  logger: bunyan;
  client: PosthogClient;
  query: string;
  timeoutSeconds: number;
  intervalSeconds: number;
  signal: AbortSignal | undefined;
}): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;

  logger.info(
    `Waiting for the PostHog query to return true. Checking every ${intervalSeconds}s for up to ${timeoutSeconds}s.`
  );

  for (;;) {
    let cell: unknown;
    try {
      cell = await client.runQueryAsync(query, logger, signal);
    } catch (error) {
      if (!(error instanceof PosthogRetryableError)) {
        throw error;
      }
      cell = undefined;
    }
    if (cell === true || (typeof cell === 'number' && cell !== 0)) {
      logger.info('Query returned true.');
      return;
    }
    logger.info('Query is not true yet. Still waiting.');

    if (!(await PosthogUtils.waitForNextPollAsync({ intervalSeconds, deadline, signal }))) {
      throw new UserError(
        'EAS_POSTHOG_QUERY_TIMEOUT',
        `The PostHog query did not return true within ${timeoutSeconds}s. It must select a single boolean, e.g. "SELECT count() > 100 FROM events".`
      );
    }
  }
}
