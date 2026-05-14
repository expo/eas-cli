import { BuildContext } from '@expo/build-tools';
import { Job } from '@expo/eas-build-job';
import { randomUUID } from 'crypto';
import { Response } from 'node-fetch';

import { reportTurtleBuildCustomMetricsAsync } from '../external/customMetrics';
import { turtleFetch } from '../utils/turtleFetch';

jest.mock('../utils/turtleFetch', () => ({
  turtleFetch: jest.fn(),
}));
jest.mock('../config', () => ({
  __esModule: true,
  default: {
    wwwApiV2BaseUrl: 'https://api.expo.test/v2/',
  },
}));
jest.mock('../logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
  },
}));

const turtleFetchMock = jest.mocked(turtleFetch);

const SAMPLE_METRIC = {
  name: 'eas.workflow.build.phase.duration',
  type: 'distribution',
  value: 1,
} as const;

function makeCtx({
  buildId,
  robotAccessToken,
}: {
  buildId?: string;
  robotAccessToken?: string;
}): BuildContext<Job> {
  return {
    env: buildId ? { EAS_BUILD_ID: buildId } : {},
    job: { secrets: robotAccessToken ? { robotAccessToken } : undefined } as Job,
  } as unknown as BuildContext<Job>;
}

describe(reportTurtleBuildCustomMetricsAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POSTs metrics to /turtle-builds/:id/custom-metrics with bearer token', async () => {
    const buildId = randomUUID();
    turtleFetchMock.mockResolvedValueOnce({} as Response);

    await reportTurtleBuildCustomMetricsAsync(makeCtx({ buildId, robotAccessToken: 'token-abc' }), [
      {
        name: 'eas.workflow.build.phase.duration',
        type: 'distribution',
        value: 1234,
        tags: { build_phase: 'install_dependencies', platform: 'ios', result: 'success' },
      },
    ]);

    expect(turtleFetchMock).toHaveBeenCalledWith(
      `https://api.expo.test/v2/turtle-builds/${buildId}/custom-metrics/`,
      'POST',
      {
        json: {
          metrics: [
            {
              name: 'eas.workflow.build.phase.duration',
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

  it('forwards multiple metrics in a single POST', async () => {
    const buildId = randomUUID();
    turtleFetchMock.mockResolvedValueOnce({} as Response);

    await reportTurtleBuildCustomMetricsAsync(makeCtx({ buildId, robotAccessToken: 'token-abc' }), [
      { name: 'eas.workflow.build.phase.duration', type: 'distribution', value: 1 },
      { name: 'eas.workflow.build.phase.duration', type: 'histogram', value: 2 },
    ]);

    expect(turtleFetchMock).toHaveBeenCalledTimes(1);
    expect(turtleFetchMock.mock.calls[0][2]).toMatchObject({
      json: {
        metrics: [
          { name: 'eas.workflow.build.phase.duration', type: 'distribution', value: 1 },
          { name: 'eas.workflow.build.phase.duration', type: 'histogram', value: 2 },
        ],
      },
    });
  });

  it('is a no-op when called with an empty array', async () => {
    await reportTurtleBuildCustomMetricsAsync(
      makeCtx({ buildId: randomUUID(), robotAccessToken: 'token-abc' }),
      []
    );

    expect(turtleFetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op when not running under a turtle build', async () => {
    await reportTurtleBuildCustomMetricsAsync(makeCtx({ robotAccessToken: 'token-abc' }), [
      SAMPLE_METRIC,
    ]);

    expect(turtleFetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op when no robot access token is available', async () => {
    await reportTurtleBuildCustomMetricsAsync(makeCtx({ buildId: randomUUID() }), [SAMPLE_METRIC]);

    expect(turtleFetchMock).not.toHaveBeenCalled();
  });

  it('swallows fetch failures so builds are not affected', async () => {
    turtleFetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      reportTurtleBuildCustomMetricsAsync(
        makeCtx({ buildId: randomUUID(), robotAccessToken: 'token-abc' }),
        [SAMPLE_METRIC]
      )
    ).resolves.toBeUndefined();
    expect(turtleFetchMock).toHaveBeenCalled();
  });
});
