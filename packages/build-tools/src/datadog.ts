import { bunyan } from '@expo/logger';

import { turtleFetch } from './utils/turtleFetch';

type DatadogSetupOptions = {
  expoApiV2BaseUrl?: string | null;
  turtleBuildId?: string | null;
  robotAccessToken?: string | null;
  logger?: bunyan;
};

type DatadogDistributionMetric = {
  name: string;
  type: 'distribution';
  value: number;
  tags?: Record<string, string>;
};

type DatadogAPI = {
  setup(opts: DatadogSetupOptions): void;
  distribution(name: string, value: number, tags?: Record<string, string>): void;
};

let setupOptions: DatadogSetupOptions = {};

export const Datadog: DatadogAPI = {
  setup(opts: DatadogSetupOptions): void {
    setupOptions = opts;
  },

  distribution(name: string, value: number, tags?: Record<string, string>): void {
    const { expoApiV2BaseUrl, turtleBuildId, robotAccessToken, logger } = setupOptions;
    if (!expoApiV2BaseUrl || !turtleBuildId || !robotAccessToken) {
      return;
    }

    const metric: DatadogDistributionMetric = {
      name,
      type: 'distribution',
      value,
      ...(tags ? { tags } : {}),
    };

    try {
      const baseUrl = expoApiV2BaseUrl.endsWith('/') ? expoApiV2BaseUrl : `${expoApiV2BaseUrl}/`;
      void turtleFetch(
        new URL(`turtle-builds/${turtleBuildId}/metrics`, baseUrl).toString(),
        'POST',
        {
          json: { metrics: [metric] },
          headers: {
            Authorization: `Bearer ${robotAccessToken}`,
          },
          retries: 2,
          logger,
        }
      ).catch(err => {
        logger?.warn({ err, metrics: [metric] }, 'Failed to report turtle build metric');
      });
    } catch (err) {
      logger?.warn({ err, metrics: [metric] }, 'Failed to report turtle build metric');
    }
  },
};
