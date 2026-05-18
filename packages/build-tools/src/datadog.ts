import { Sentry } from './sentry';
import { turtleFetch } from './utils/turtleFetch';

type DatadogSetupOptions = {
  expoApiV2BaseUrl: string;
  turtleBuildOrJobRunId: string;
  robotAccessToken: string;
};

let setupOptions: DatadogSetupOptions | null = null;
let pendingMetricUploads: Promise<void>[] = [];

export const Datadog = {
  setup(opts: DatadogSetupOptions | null): void {
    setupOptions = opts;
  },

  distribution(name: string, value: number, tags?: Record<string, string>): void {
    if (!setupOptions) {
      return;
    }
    const { expoApiV2BaseUrl, turtleBuildOrJobRunId, robotAccessToken } = setupOptions;
    const metrics = [
      {
        name,
        type: 'distribution' as const,
        value,
        ...(tags ? { tags } : {}),
      },
    ];

    try {
      const uploadPromise = turtleFetch(
        new URL(
          `turtle-builds/${turtleBuildOrJobRunId}/metrics`,
          expoApiV2BaseUrl.endsWith('/') ? expoApiV2BaseUrl : `${expoApiV2BaseUrl}/`
        ).toString(),
        'POST',
        {
          json: { metrics },
          headers: {
            Authorization: `Bearer ${robotAccessToken}`,
          },
          retries: 2,
        }
      ).then(
        () => undefined,
        err => {
          Sentry.capture('Failed to report turtle build metric', err, {
            extras: { metrics },
          });
        }
      );

      pendingMetricUploads.push(uploadPromise);
      void uploadPromise.finally(() => {
        pendingMetricUploads = pendingMetricUploads.filter(p => p !== uploadPromise);
      });
    } catch (err) {
      Sentry.capture('Failed to report turtle build metric', err as Error, {
        extras: { metrics },
      });
    }
  },

  async flushAsync(): Promise<void> {
    while (pendingMetricUploads.length > 0) {
      await Promise.allSettled(pendingMetricUploads);
    }
  },
};
