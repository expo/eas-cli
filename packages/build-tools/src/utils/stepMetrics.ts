import { bunyan } from '@expo/logger';
import { StepMetric } from '@expo/steps';

import { turtleFetch } from './turtleFetch';

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
  stepMetrics: StepMetric[];
  logger: bunyan;
}): Promise<void> {
  try {
    await turtleFetch(
      new URL(`workflows/${workflowJobId}/metrics`, expoApiV2BaseUrl).toString(),
      'POST',
      {
        json: { stepMetrics },
        headers: { Authorization: `Bearer ${robotAccessToken}` },
        timeout: 5000,
        retries: 2,
        logger,
      }
    );
  } catch {
    // Don't fail the build for metrics — silently give up
  }
}
