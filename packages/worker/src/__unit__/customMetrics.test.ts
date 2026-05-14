import { BuildContext } from '@expo/build-tools';
import { Job } from '@expo/eas-build-job';
import { randomUUID } from 'crypto';
import { Response } from 'node-fetch';

import { reportWorkflowCustomMetricAsync } from '../external/customMetrics';
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
    info: jest.fn(),
  },
}));

const turtleFetchMock = jest.mocked(turtleFetch);

function makeCtx({
  workflowJobId,
  robotAccessToken,
}: {
  workflowJobId?: string;
  robotAccessToken?: string;
}): BuildContext<Job> {
  return {
    env: workflowJobId ? { __WORKFLOW_JOB_ID: workflowJobId } : {},
    job: { secrets: robotAccessToken ? { robotAccessToken } : undefined } as Job,
  } as unknown as BuildContext<Job>;
}

describe(reportWorkflowCustomMetricAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POSTs to /workflows/:id/custom-metrics with bearer token', async () => {
    const workflowJobId = randomUUID();
    turtleFetchMock.mockResolvedValueOnce({} as Response);

    await reportWorkflowCustomMetricAsync(
      makeCtx({ workflowJobId, robotAccessToken: 'token-abc' }),
      {
        name: 'eas.workflow.build.phase.duration',
        value: 1234,
        tags: { build_phase: 'install_dependencies', platform: 'ios', result: 'success' },
      }
    );

    expect(turtleFetchMock).toHaveBeenCalledWith(
      `https://api.expo.test/v2/workflows/${workflowJobId}/custom-metrics/`,
      'POST',
      {
        json: {
          metrics: [
            {
              name: 'eas.workflow.build.phase.duration',
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
      }
    );
  });

  it('is a no-op when not running under a workflow job', async () => {
    await reportWorkflowCustomMetricAsync(makeCtx({ robotAccessToken: 'token-abc' }), {
      name: 'eas.workflow.build.phase.duration',
      value: 1,
    });

    expect(turtleFetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op when no robot access token is available', async () => {
    await reportWorkflowCustomMetricAsync(makeCtx({ workflowJobId: randomUUID() }), {
      name: 'eas.workflow.build.phase.duration',
      value: 1,
    });

    expect(turtleFetchMock).not.toHaveBeenCalled();
  });

  it('swallows fetch failures so builds are not affected', async () => {
    turtleFetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(
      reportWorkflowCustomMetricAsync(
        makeCtx({ workflowJobId: randomUUID(), robotAccessToken: 'token-abc' }),
        { name: 'eas.workflow.build.phase.duration', value: 1 }
      )
    ).resolves.toBeUndefined();
  });
});
