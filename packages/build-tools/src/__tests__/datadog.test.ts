import { Response } from 'node-fetch';

import { Datadog } from '../datadog';
import { Sentry } from '../sentry';
import { turtleFetch } from '../utils/turtleFetch';

jest.mock('../sentry', () => ({
  Sentry: {
    capture: jest.fn(),
  },
}));
jest.mock('../utils/turtleFetch', () => ({
  turtleFetch: jest.fn(),
}));

const turtleFetchMock = jest.mocked(turtleFetch);
const sentryCaptureMock = jest.mocked(Sentry.capture);

describe('Datadog singleton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Datadog.setup(null);
  });

  it('POSTs distribution metrics to the turtle build metrics endpoint for build targets', () => {
    turtleFetchMock.mockResolvedValueOnce({} as Response);

    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'build', turtleBuildId: 'build-id' },
    });

    Datadog.distribution('eas.build.phase_duration', 1234, {
      build_phase: 'install_dependencies',
      platform: 'ios',
      result: 'success',
    });

    expect(turtleFetchMock).toHaveBeenCalledWith(
      'https://api.expo.test/v2/turtle-builds/build-id/metrics',
      'POST',
      {
        json: {
          metrics: [
            {
              name: 'eas.build.phase_duration',
              type: 'distribution',
              value: 1234,
              tags: {
                build_phase: 'install_dependencies',
                platform: 'ios',
                result: 'success',
              },
            },
          ],
        },
        headers: { Authorization: 'Bearer token-abc' },
        retries: 2,
      }
    );
  });

  it('POSTs distribution metrics to the turtle job run metrics endpoint for jobRun targets', () => {
    turtleFetchMock.mockResolvedValueOnce({} as Response);

    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'jobRun', turtleJobRunId: 'job-run-id' },
    });

    Datadog.distribution('eas.workflow.maestro_cli_version', 1, {
      maestro_version: '2.1.0',
    });

    expect(turtleFetchMock).toHaveBeenCalledWith(
      'https://api.expo.test/v2/turtle-job-runs/job-run-id/metrics',
      'POST',
      {
        json: {
          metrics: [
            {
              name: 'eas.workflow.maestro_cli_version',
              type: 'distribution',
              value: 1,
              tags: {
                maestro_version: '2.1.0',
              },
            },
          ],
        },
        headers: { Authorization: 'Bearer token-abc' },
        retries: 2,
      }
    );
  });

  it('POSTs logs to the turtle build logs endpoint with buildId for build targets', () => {
    turtleFetchMock.mockResolvedValueOnce({} as Response);

    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'build', turtleBuildId: 'build-id' },
    });

    Datadog.log('artifact dry-run matched', {
      event: 'find_artifacts_absolute_path_dry_run',
      status: 'match',
    });

    expect(turtleFetchMock).toHaveBeenCalledWith(
      'https://api.expo.test/v2/turtle-builds/logs',
      'POST',
      {
        json: {
          buildId: 'build-id',
          message: 'artifact dry-run matched',
          tags: {
            event: 'find_artifacts_absolute_path_dry_run',
            status: 'match',
          },
        },
        headers: { Authorization: 'Bearer token-abc' },
        shouldThrowOnNotOk: false,
      }
    );
  });

  it('POSTs logs to the turtle job run logs endpoint with jobRunId for jobRun targets', () => {
    turtleFetchMock.mockResolvedValueOnce({} as Response);

    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'jobRun', turtleJobRunId: 'job-run-id' },
    });

    Datadog.log('Gradle cache restored (hit)', {
      cache_type: 'gradle',
    });

    expect(turtleFetchMock).toHaveBeenCalledWith(
      'https://api.expo.test/v2/turtle-job-runs/logs',
      'POST',
      {
        json: {
          jobRunId: 'job-run-id',
          message: 'Gradle cache restored (hit)',
          tags: {
            cache_type: 'gradle',
          },
        },
        headers: { Authorization: 'Bearer token-abc' },
        shouldThrowOnNotOk: false,
      }
    );
  });

  it('is a no-op when setup is null', () => {
    Datadog.setup(null);

    Datadog.distribution('eas.build.phase_duration', 1);
    Datadog.log('artifact dry-run matched');

    expect(turtleFetchMock).not.toHaveBeenCalled();
  });

  it('swallows metric upload failures for build targets', async () => {
    turtleFetchMock.mockRejectedValueOnce(new Error('network down'));
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'build', turtleBuildId: 'build-id' },
    });

    Datadog.distribution('eas.build.phase_duration', 1);
    await flushPromises();

    expect(turtleFetchMock).toHaveBeenCalled();
    expect(sentryCaptureMock).toHaveBeenCalledWith(
      'Failed to report turtle build metric',
      expect.any(Error),
      expect.objectContaining({
        extras: {
          metrics: [{ name: 'eas.build.phase_duration', type: 'distribution', value: 1, tags: {} }],
        },
      })
    );
  });

  it('labels metric upload failures for jobRun targets with the jobRun kind', async () => {
    turtleFetchMock.mockRejectedValueOnce(new Error('network down'));
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'jobRun', turtleJobRunId: 'job-run-id' },
    });

    Datadog.distribution('eas.workflow.maestro_cli_version', 1);
    await flushPromises();

    expect(sentryCaptureMock).toHaveBeenCalledWith(
      'Failed to report turtle jobRun metric',
      expect.any(Error),
      expect.objectContaining({
        extras: {
          metrics: [
            { name: 'eas.workflow.maestro_cli_version', type: 'distribution', value: 1, tags: {} },
          ],
        },
      })
    );
  });

  it('swallows log upload failures for build targets', async () => {
    turtleFetchMock.mockRejectedValueOnce(new Error('network down'));
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'build', turtleBuildId: 'build-id' },
    });

    Datadog.log('artifact dry-run matched');
    await flushPromises();

    expect(turtleFetchMock).toHaveBeenCalled();
    expect(sentryCaptureMock).toHaveBeenCalledWith(
      'Failed to report turtle build log',
      expect.any(Error),
      expect.objectContaining({
        extras: {
          log: { buildId: 'build-id', message: 'artifact dry-run matched', tags: {} },
        },
      })
    );
  });

  it('labels log upload failures for jobRun targets with the jobRun kind', async () => {
    turtleFetchMock.mockRejectedValueOnce(new Error('network down'));
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'jobRun', turtleJobRunId: 'job-run-id' },
    });

    Datadog.log('Gradle cache restored (hit)');
    await flushPromises();

    expect(sentryCaptureMock).toHaveBeenCalledWith(
      'Failed to report turtle jobRun log',
      expect.any(Error),
      expect.objectContaining({
        extras: {
          log: { jobRunId: 'job-run-id', message: 'Gradle cache restored (hit)', tags: {} },
        },
      })
    );
  });

  it('uses the latest setup options', () => {
    turtleFetchMock.mockResolvedValue({} as Response);

    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'first-token',
      target: { kind: 'build', turtleBuildId: 'first-build-id' },
    });
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'second-token',
      target: { kind: 'jobRun', turtleJobRunId: 'job-run-id' },
    });

    Datadog.distribution('eas.build.phase_duration', 1);
    Datadog.log('artifact dry-run matched');

    expect(turtleFetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.expo.test/v2/turtle-job-runs/job-run-id/metrics',
      'POST',
      expect.objectContaining({
        headers: { Authorization: 'Bearer second-token' },
      })
    );
    expect(turtleFetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.expo.test/v2/turtle-job-runs/logs',
      'POST',
      expect.objectContaining({
        headers: { Authorization: 'Bearer second-token' },
      })
    );
  });

  it('flushes pending metric uploads', async () => {
    let resolveUpload!: (response: Response) => void;
    turtleFetchMock.mockReturnValueOnce(
      new Promise<Response>(resolve => {
        resolveUpload = resolve;
      })
    );
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'build', turtleBuildId: 'build-id' },
    });

    let flushed = false;
    Datadog.distribution('eas.build.phase_duration', 1);
    const flushPromise = Datadog.flushAsync().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    resolveUpload({} as Response);
    await flushPromise;

    expect(flushed).toBe(true);
  });

  it('flushes pending log uploads', async () => {
    let resolveUpload!: (response: Response) => void;
    turtleFetchMock.mockReturnValueOnce(
      new Promise<Response>(resolve => {
        resolveUpload = resolve;
      })
    );
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'build', turtleBuildId: 'build-id' },
    });

    let flushed = false;
    Datadog.log('artifact dry-run matched');
    const flushPromise = Datadog.flushAsync().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    resolveUpload({} as Response);
    await flushPromise;

    expect(flushed).toBe(true);
  });

  it('only awaits uploads enqueued since the previous flush', async () => {
    let resolveSecondUpload!: (response: Response) => void;
    turtleFetchMock.mockReturnValueOnce(new Promise<Response>(() => {})).mockReturnValueOnce(
      new Promise<Response>(resolve => {
        resolveSecondUpload = resolve;
      })
    );
    Datadog.setup({
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
      robotAccessToken: 'token-abc',
      target: { kind: 'build', turtleBuildId: 'build-id' },
    });

    // The first upload never settles; the first flush rotates it out of the queue.
    Datadog.distribution('eas.build.phase_duration', 1);
    void Datadog.flushAsync();

    Datadog.distribution('eas.build.phase_duration', 2);
    let flushed = false;
    const flushPromise = Datadog.flushAsync().then(() => {
      flushed = true;
    });

    resolveSecondUpload({} as Response);
    await flushPromise;

    expect(flushed).toBe(true);
  });
});

async function flushPromises(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}
