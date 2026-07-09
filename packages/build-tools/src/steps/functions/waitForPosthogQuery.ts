import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';

import {
  PosthogClient,
  PosthogRetryableError,
  missingPosthogCredentialsMessage,
} from '../utils/PosthogClient';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

const DEFAULT_TIMEOUT_SECONDS = 600;
const DEFAULT_INTERVAL_SECONDS = 30;

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
        defaultValue: DEFAULT_TIMEOUT_SECONDS,
      }),
      BuildStepInput.createProvider({
        id: 'interval_seconds',
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
        required: false,
        defaultValue: DEFAULT_INTERVAL_SECONDS,
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
      if (timeoutSeconds <= 0 || intervalSeconds <= 0) {
        throw new UserError(
          'EAS_POSTHOG_QUERY_INVALID_INTERVAL',
          '"timeout_seconds" and "interval_seconds" must be greater than 0.'
        );
      }

      const result = PosthogClient.fromEnv({
        apiKeyOverride: inputs.api_key.value as string | undefined,
        projectIdOverride: inputs.project_id.value as string | undefined,
        env,
      });
      if (!result.client) {
        throw new UserError(
          'EAS_POSTHOG_MISSING_CREDENTIALS',
          missingPosthogCredentialsMessage(result.missing)
        );
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
      cell = await client.runQueryAsync(query, logger);
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

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new UserError(
        'EAS_POSTHOG_QUERY_TIMEOUT',
        `The PostHog query did not return true within ${timeoutSeconds}s. It must select a single boolean, e.g. "SELECT count() > 100 FROM events".`
      );
    }
    await setTimeoutAsync(Math.min(intervalSeconds * 1000, remainingMs), undefined, { signal });
  }
}
