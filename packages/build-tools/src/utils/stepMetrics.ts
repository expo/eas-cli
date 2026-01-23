import { StepMetricsCollection } from '@expo/steps';
import { bunyan } from '@expo/logger';

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
