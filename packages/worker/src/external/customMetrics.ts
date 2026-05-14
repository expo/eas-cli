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

export async function reportWorkflowCustomMetricsAsync(
  ctx: BuildContext<Job>,
  metrics: WorkflowCustomMetric[]
): Promise<void> {
  if (metrics.length === 0) {
    return;
  }
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
        json: { metrics },
        headers: {
          Authorization: `Bearer ${robotAccessToken}`,
        },
      }
    );
  } catch (err) {
    logger.warn({ err, metrics }, 'Failed to report workflow custom metrics');
  }
}
