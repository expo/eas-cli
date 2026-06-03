import { Sentry } from './sentry';
import { turtleFetch } from './utils/turtleFetch';

type MetricsTarget =
  | { kind: 'build'; turtleBuildId: string }
  | { kind: 'jobRun'; turtleJobRunId: string };

type DatadogSetupOptions = {
  expoApiV2BaseUrl: string;
  robotAccessToken: string;
  target: MetricsTarget;
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
    const { expoApiV2BaseUrl, robotAccessToken, target } = setupOptions;
    const metrics = [
      {
        name,
        type: 'distribution' as const,
        value,
        tags,
      },
    ];

    const metricsPath =
      target.kind === 'build'
        ? `turtle-builds/${target.turtleBuildId}/metrics`
        : `turtle-job-runs/${target.turtleJobRunId}/metrics`;

    const uploadPromise = turtleFetch(new URL(metricsPath, expoApiV2BaseUrl).toString(), 'POST', {
      json: { metrics },
      headers: {
        Authorization: `Bearer ${robotAccessToken}`,
      },
      retries: 2,
    }).catch(err => {
      Sentry.capture(`Failed to report turtle ${target.kind} metric`, err, {
        extras: { metrics },
      });
    });

    pendingUploads.push(uploadPromise);
  },

  log(message: string, tags: Record<string, string> = {}): void {
    if (!setupOptions) {
      return;
    }
    const { expoApiV2BaseUrl, robotAccessToken, target } = setupOptions;
    const log =
      target.kind === 'build'
        ? { buildId: target.turtleBuildId, message, tags }
        : { jobRunId: target.turtleJobRunId, message, tags };
    const logsPath = target.kind === 'build' ? 'turtle-builds/logs' : 'turtle-job-runs/logs';

    const uploadPromise = turtleFetch(new URL(logsPath, expoApiV2BaseUrl).toString(), 'POST', {
      json: log,
      headers: {
        Authorization: `Bearer ${robotAccessToken}`,
      },
      shouldThrowOnNotOk: false,
    }).catch(err => {
      Sentry.capture(`Failed to report turtle ${target.kind} log`, err, {
        extras: { log },
      });
    });

    pendingUploads.push(uploadPromise);
  },

  async flushAsync(): Promise<void> {
    // Rotate so each flush only awaits its own batch; uploads enqueued during the
    // await land in the fresh array for a later flush.
    const uploads = pendingUploads;
    pendingUploads = [];
    await Promise.allSettled(uploads);
  },
};
