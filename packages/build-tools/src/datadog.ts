import { Sentry } from './sentry';
import { turtleFetch } from './utils/turtleFetch';

type DatadogSetupOptions = {
  expoApiV2BaseUrl: string;
  turtleBuildId: string;
  robotAccessToken: string;
};

let setupOptions: DatadogSetupOptions | null = null;
let pendingUploads: Promise<unknown>[] = [];

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

    pendingUploads.push(uploadPromise);
  },

  log(message: string, tags: Record<string, string> = {}): void {
    if (!setupOptions) {
      return;
    }
    const { expoApiV2BaseUrl, turtleBuildId, robotAccessToken } = setupOptions;
    const log = {
      buildId: turtleBuildId,
      message,
      tags,
    };

    const uploadPromise = turtleFetch(
      new URL('turtle-builds/logs', expoApiV2BaseUrl).toString(),
      'POST',
      {
        json: log,
        headers: {
          Authorization: `Bearer ${robotAccessToken}`,
        },
        shouldThrowOnNotOk: false,
      }
    ).catch(err => {
      Sentry.capture('Failed to report turtle build log', err, {
        extras: { log },
      });
    });

    pendingUploads.push(uploadPromise);
  },

  async flushAsync(): Promise<void> {
    await Promise.allSettled(pendingUploads);
  },
};
