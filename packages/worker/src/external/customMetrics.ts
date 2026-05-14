import { BuildContext } from '@expo/build-tools';
import { Job } from '@expo/eas-build-job';

import config from '../config';
import logger from '../logger';
import { turtleFetch } from '../utils/turtleFetch';

interface TurtleBuildCustomMetric {
  name: string;
  type: 'histogram' | 'distribution';
  value: number;
  tags?: Record<string, string>;
}

export async function reportTurtleBuildCustomMetricsAsync(
  ctx: BuildContext<Job>,
  metrics: TurtleBuildCustomMetric[]
): Promise<void> {
  if (metrics.length === 0) {
    return;
  }
  const buildId = ctx.env.EAS_BUILD_ID;
  if (!buildId) {
    return;
  }
  const robotAccessToken = ctx.job.secrets?.robotAccessToken;
  if (!robotAccessToken) {
    return;
  }

  try {
    await turtleFetch(
      new URL(`turtle-builds/${buildId}/custom-metrics/`, config.wwwApiV2BaseUrl).toString(),
      'POST',
      {
        json: { metrics },
        headers: {
          Authorization: `Bearer ${robotAccessToken}`,
        },
        // Datadog distribution/histogram tolerates duplicate samples, so retrying
        // transient www failures is safer than dropping the data point.
        retries: 2,
      }
    );
  } catch (err) {
    logger.warn({ err, metrics }, 'Failed to report turtle build custom metrics');
  }
}
