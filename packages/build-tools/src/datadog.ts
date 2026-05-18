import { Sentry } from './sentry';
import { turtleFetch } from './utils/turtleFetch';

type DatadogSetupOptions = {
  expoApiV2BaseUrl: string;
  turtleBuildOrJobRunId: string;
  robotAccessToken?: string;
};

let setupOptions: DatadogSetupOptions | null = null;

export const Datadog = {
  setup(opts: DatadogSetupOptions | null): void {
    setupOptions = opts;
  },

  distribution(name: string, value: number, tags?: Record<string, string>): void {
    if (!setupOptions?.robotAccessToken) {
      return;
    }
    const { expoApiV2BaseUrl, turtleBuildOrJobRunId, robotAccessToken } = setupOptions;

    const metric = {
      name,
      type: 'distribution' as const,
      value,
      ...(tags ? { tags } : {}),
    };

    void (async () => {
      const baseUrl = expoApiV2BaseUrl.endsWith('/') ? expoApiV2BaseUrl : `${expoApiV2BaseUrl}/`;
      await turtleFetch(
        new URL(`turtle-builds/${turtleBuildOrJobRunId}/metrics`, baseUrl).toString(),
        'POST',
        {
          json: { metrics: [metric] },
          headers: {
            Authorization: `Bearer ${robotAccessToken}`,
          },
          retries: 2,
        }
      );
    })().catch(err => {
      Sentry.capture('Failed to report turtle build metric', err, {
        extras: { metrics: [metric] },
      });
    });
  },
};
