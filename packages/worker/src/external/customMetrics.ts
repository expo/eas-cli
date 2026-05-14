import { BuildContext } from '@expo/build-tools';
import { Job } from '@expo/eas-build-job';

import config from '../config';
import logger from '../logger';
import { turtleFetch } from '../utils/turtleFetch';

interface WorkflowCustomMetric {
  name: string;
  value: number;
  tags?: Record<string, string>;
}

export async function reportWorkflowCustomMetricAsync(
  ctx: BuildContext<Job>,
  metric: WorkflowCustomMetric
): Promise<void> {
  const workflowJobId = ctx.env.__WORKFLOW_JOB_ID;
  if (!workflowJobId) {
    return;
  }
  const robotAccessToken = ctx.job.secrets?.robotAccessToken;
  if (!robotAccessToken) {
    return;
  }

  try {
    await turtleFetch(
      new URL(`workflows/${workflowJobId}/custom-metrics/`, config.wwwApiV2BaseUrl).toString(),
      'POST',
      {
        json: { metrics: [metric] },
        headers: {
          Authorization: `Bearer ${robotAccessToken}`,
        },
      }
    );
  } catch (err) {
    logger.warn({ err, metric }, 'Failed to report workflow custom metric');
  }
}
