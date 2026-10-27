import { Sentry } from './sentry';
import { DEVICE_RUN_SESSION_TOKEN_HEADER } from './steps/utils/deviceRunSessionWorkerApi';
import { turtleFetch } from './utils/turtleFetch';

type MetricsTarget =
  | { kind: 'build'; turtleBuildId: string }
  | { kind: 'jobRun'; turtleJobRunId: string }
  // A device run session job with a session token. The token names the session and its job run.
  | { kind: 'deviceRunSession' };

type DatadogSetupOptions =
  | {
      expoApiV2BaseUrl: string;
      robotAccessToken: string;
      target: Exclude<MetricsTarget, { kind: 'deviceRunSession' }>;
    }
  | {
      expoApiV2BaseUrl: string;
      deviceRunSessionToken: string;
      target: Extract<MetricsTarget, { kind: 'deviceRunSession' }>;
    };

let setupOptions: DatadogSetupOptions | null = null;
let pendingUploads: Promise<unknown>[] = [];

function withTargetTag(
  tags: Record<string, string>,
  target: MetricsTarget
): Record<string, string> {
  // A device run session job is a job run, so its metrics keep the job run tag.
  return { ...tags, target: target.kind === 'build' ? 'build' : 'job_run' };
}

function getMetricsRequest(options: DatadogSetupOptions): {
  path: string;
  headers: Record<string, string>;
} {
  if ('deviceRunSessionToken' in options) {
    return {
      path: 'device-run-session-worker/metrics',
      headers: { [DEVICE_RUN_SESSION_TOKEN_HEADER]: options.deviceRunSessionToken },
    };
  }
  const { target, robotAccessToken } = options;
  return {
    path:
      target.kind === 'build'
        ? `turtle-builds/${target.turtleBuildId}/metrics`
        : `turtle-job-runs/${target.turtleJobRunId}/metrics`,
    headers: { Authorization: `Bearer ${robotAccessToken}` },
  };
}

export const Datadog = {
  setup(opts: DatadogSetupOptions | null): void {
    setupOptions = opts;
  },

  distribution(name: string, value: number, tags: Record<string, string> = {}): void {
    if (!setupOptions) {
      return;
    }
    const { expoApiV2BaseUrl, target } = setupOptions;
    const metrics = [
      {
        name,
        type: 'distribution' as const,
        value,
        tags: withTargetTag(tags, target),
      },
    ];

    const { path: metricsPath, headers } = getMetricsRequest(setupOptions);

    const uploadPromise = turtleFetch(new URL(metricsPath, expoApiV2BaseUrl).toString(), 'POST', {
      json: { metrics },
      headers,
      retries: 2,
    }).catch(err => {
      Sentry.capture(`Failed to report turtle ${target.kind} metric`, err, {
        extras: { metrics },
      });
    });

    pendingUploads.push(uploadPromise);
  },

  log(message: string, tags: Record<string, string> = {}): void {
    // The device run session worker API has no logs route, and the session token is not a bearer
    // credential, so a device run session job does not report these logs.
    if (!setupOptions || !('robotAccessToken' in setupOptions)) {
      return;
    }
    const { expoApiV2BaseUrl, robotAccessToken, target } = setupOptions;
    const tagsWithTarget = withTargetTag(tags, target);
    const log =
      target.kind === 'build'
        ? { buildId: target.turtleBuildId, message, tags: tagsWithTarget }
        : { jobRunId: target.turtleJobRunId, message, tags: tagsWithTarget };
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
