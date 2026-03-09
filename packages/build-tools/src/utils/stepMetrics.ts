import { bunyan } from '@expo/logger';
import { StepMetric, StepMetricsCollection } from '@expo/steps';

import { sleepAsync } from './retry';
import { TurtleFetchError, turtleFetch } from './turtleFetch';

export async function uploadStepMetricsToWwwAsync({
  workflowJobId,
  robotAccessToken,
  expoApiV2BaseUrl,
  stepMetrics,
  logger,
}: {
  workflowJobId: string;
  robotAccessToken: string;
  expoApiV2BaseUrl: string;
  stepMetrics: StepMetricsCollection;
  logger: bunyan;
}): Promise<void> {
  if (stepMetrics.length === 0) {
    logger.debug('No step metrics to upload');
    return;
  }

  try {
    await turtleFetch(
      new URL(`workflows/${workflowJobId}/metrics`, expoApiV2BaseUrl).toString(),
      'POST',
      {
        json: { stepMetrics },
        headers: {
          Authorization: `Bearer ${robotAccessToken}`,
        },
        timeout: 20000,
        logger,
      }
    );
    logger.info(`Uploaded ${stepMetrics.length} step metrics`);
  } catch {
    // Don't display unactionable error to the user, let's send it to Sentry in the future
  }
}

export async function uploadStepMetricToWwwAsync({
  workflowJobId,
  robotAccessToken,
  expoApiV2BaseUrl,
  stepMetric,
  logger,
}: {
  workflowJobId: string;
  robotAccessToken: string;
  expoApiV2BaseUrl: string;
  stepMetric: StepMetric;
  logger: bunyan;
}): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await turtleFetch(
        new URL(`workflows/${workflowJobId}/metrics`, expoApiV2BaseUrl).toString(),
        'POST',
        {
          json: { stepMetrics: [stepMetric] },
          headers: { Authorization: `Bearer ${robotAccessToken}` },
          timeout: 20000,
          logger,
        }
      );
      return;
    } catch (err) {
      const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];
      const isRetryable =
        !(err instanceof TurtleFetchError) || RETRYABLE_STATUSES.includes(err.response.status);
      if (!isRetryable || attempt === maxAttempts - 1) {
        return; // Silently give up — don't fail the build for metrics
      }
      logger.debug({ err }, `Step metric upload attempt ${attempt + 1} failed, retrying`);
      await sleepAsync(1_000);
    }
  }
}
