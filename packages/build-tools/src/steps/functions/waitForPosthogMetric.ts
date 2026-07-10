import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';

import {
  PosthogClient,
  PosthogRetryableError,
  missingPosthogCredentialsError,
} from '../utils/PosthogClient';
import { PosthogUtils } from '../utils/PosthogUtils';

const OPERATORS = {
  lt: { symbol: '<', test: (value: number, threshold: number) => value < threshold },
  lte: { symbol: '<=', test: (value: number, threshold: number) => value <= threshold },
  gt: { symbol: '>', test: (value: number, threshold: number) => value > threshold },
  gte: { symbol: '>=', test: (value: number, threshold: number) => value >= threshold },
  eq: { symbol: '=', test: (value: number, threshold: number) => value === threshold },
};

type Operator = keyof typeof OPERATORS;

export function createWaitForPosthogMetricFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'posthog_wait_for_metric',
    name: 'Wait for a PostHog metric',
    __metricsId: 'eas/posthog_wait_for_metric',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'query',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: true,
      }),
      BuildStepInput.createProvider({
        id: 'operator',
        allowedValues: Object.keys(OPERATORS),
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: true,
      }),
      BuildStepInput.createProvider({
        id: 'threshold',
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
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
    outputProviders: [BuildStepOutput.createProvider({ id: 'value', required: false })],
    fn: async (stepCtx, { inputs, outputs, env, signal }) => {
      const { logger } = stepCtx;

      const operator = inputs.operator.value as string;
      if (!Object.keys(OPERATORS).includes(operator)) {
        throw new UserError(
          'EAS_POSTHOG_METRIC_INVALID_OPERATOR',
          `Invalid "operator" "${operator}". Must be one of: ${Object.keys(OPERATORS).join(', ')}.`
        );
      }
      const timeoutSeconds = inputs.timeout_seconds.value as number;
      const intervalSeconds = inputs.interval_seconds.value as number;
      PosthogUtils.assertPollBoundsPositive({
        timeoutSeconds,
        intervalSeconds,
        errorCode: 'EAS_POSTHOG_METRIC_INVALID_INTERVAL',
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

      const value = await waitForPosthogMetricAsync({
        logger,
        client,
        query: inputs.query.value as string,
        operator: operator as Operator,
        threshold: inputs.threshold.value as number,
        timeoutSeconds,
        intervalSeconds,
        signal,
      });
      outputs.value.set(String(value));
    },
  });
}

async function waitForPosthogMetricAsync({
  logger,
  client,
  query,
  operator,
  threshold,
  timeoutSeconds,
  intervalSeconds,
  signal,
}: {
  logger: bunyan;
  client: PosthogClient;
  query: string;
  operator: Operator;
  threshold: number;
  timeoutSeconds: number;
  intervalSeconds: number;
  signal: AbortSignal | undefined;
}): Promise<number> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const { symbol, test } = OPERATORS[operator];
  const target = `${symbol} ${threshold}`;
  let lastValue: number | undefined;

  logger.info(
    `Waiting for the PostHog metric to reach ${target}. Checking every ${intervalSeconds}s for up to ${timeoutSeconds}s.`
  );

  for (;;) {
    let value: number | undefined = undefined;
    try {
      value = await queryMetricAsync({ logger, client, query, signal });
    } catch (error) {
      if (!(error instanceof PosthogRetryableError)) {
        throw error;
      }
    }
    if (value !== undefined) {
      lastValue = value;
      if (test(value, threshold)) {
        logger.info(`Metric is ${value}. Target ${target} met.`);
        return value;
      }
      logger.info(`Metric is ${value}. Still waiting for ${target}.`);
    } else {
      logger.info('The query has not returned a numeric value yet. Still waiting.');
    }

    if (!(await PosthogUtils.waitForNextPollAsync({ intervalSeconds, deadline, signal }))) {
      throw new UserError(
        'EAS_POSTHOG_METRIC_TIMEOUT',
        lastValue !== undefined
          ? `The PostHog metric did not reach ${target} within ${timeoutSeconds}s (last value: ${lastValue}).`
          : `The PostHog query never returned a numeric value within ${timeoutSeconds}s. Check that the query returns a single number and that PostHog is reachable.`
      );
    }
  }
}

async function queryMetricAsync({
  logger,
  client,
  query,
  signal,
}: {
  logger: bunyan;
  client: PosthogClient;
  query: string;
  signal: AbortSignal | undefined;
}): Promise<number | undefined> {
  const cell = await client.runQueryAsync(query, logger, signal);
  return typeof cell === 'number' && Number.isFinite(cell) ? cell : undefined;
}
