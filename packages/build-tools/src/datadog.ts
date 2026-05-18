import { Sentry } from './sentry';
import { turtleFetch } from './utils/turtleFetch';

type DatadogSetupOptions = {
  expoApiV2BaseUrl: string;
  turtleBuildId: string;
  robotAccessToken: string;
};

let setupOptions: DatadogSetupOptions | null = null;
let pendingMetricUploads: Promise<unknown>[] = [];

export const Datadog = {
  setup(opts: DatadogSetupOptions | null): void {
    setupOptions = opts;
  },

  distribution(name: string, value: number, tags: Record<string, string> = {}): void {
    if (!setupOptions) {
      return;
    }
    const { expoApiV2BaseUrl, turtleBuildId, robotAccessToken } = setupOptions;
    const metrics = [
      {
        name,
        type: 'distribution' as const,
        value,
        tags,
      },
    ];

    const uploadPromise = turtleFetch(
      new URL(`turtle-builds/${turtleBuildId}/metrics`, expoApiV2BaseUrl).toString(),
      'POST',
      {
        json: { metrics },
        headers: {
          Authorization: `Bearer ${robotAccessToken}`,
        },
        retries: 2,
      }
    ).catch(err => {
      Sentry.capture('Failed to report turtle build metric', err, {
        extras: { metrics },
      });
    });

    pendingMetricUploads.push(uploadPromise);
  },

  async flushAsync(): Promise<void> {
    await Promise.allSettled(pendingMetricUploads);
  },
};
