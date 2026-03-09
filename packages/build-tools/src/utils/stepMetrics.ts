import { bunyan } from '@expo/logger';
import { StepMetric } from '@expo/steps';

import { sleepAsync } from './retry';
import { turtleFetch } from './turtleFetch';

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
      if (attempt === maxAttempts - 1) {
        return; // Silently give up — don't fail the build for metrics
      }
      logger.debug({ err }, `Step metric upload attempt ${attempt + 1} failed, retrying`);
      await sleepAsync(1_000);
    }
  }
}
