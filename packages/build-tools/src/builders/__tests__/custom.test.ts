import { BuildJob } from '@expo/eas-build-job';
import { BuildWorkflow } from '@expo/steps';
import { vol } from 'memfs';

import { createTestIosJob } from '../../__tests__/utils/job';
import { createMockLogger } from '../../__tests__/utils/logger';
import { prepareProjectSourcesAsync } from '../../common/projectSources';
import { BuildContext } from '../../context';
import { CustomBuildContext } from '../../customBuildContext';
import { findAndUploadXcodeBuildLogsAsync } from '../../ios/xcodeBuildLogs';
import { uploadJobOutputsToWwwAsync } from '../../utils/outputs';
import { runCustomBuildAsync } from '../custom';

jest.mock('../../common/projectSources');
jest.mock('../../ios/xcodeBuildLogs');
jest.mock('../../utils/outputs');

const findAndUploadXcodeBuildLogsAsyncMock = jest.mocked(findAndUploadXcodeBuildLogsAsync);
const uploadJobOutputsToWwwAsyncMock = jest.mocked(uploadJobOutputsToWwwAsync);

describe(runCustomBuildAsync, () => {
  let ctx: BuildContext<BuildJob>;

  beforeEach(() => {
    jest.clearAllMocks();

    const job = createTestIosJob();

    jest.mocked(prepareProjectSourcesAsync).mockImplementation(async () => {
      vol.mkdirSync('/workingdir/env', { recursive: true });
      vol.mkdirSync('/workingdir/temporary-custom-build', { recursive: true });
      vol.fromJSON(
        {
          'test.yaml': `
          build:
            steps:
              - eas/checkout
          `,
        },
        '/workingdir/temporary-custom-build'
      );
      return { handled: true };
    });

    ctx = new BuildContext(
      {
        ...job,
        customBuildConfig: {
          path: 'test.yaml',
        },
      },
      {
        workingdir: '/workingdir',
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        logger: createMockLogger(),
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
        },
        uploadArtifact: jest.fn(),
      }
    );
  });

  it('uploads job outputs after workflow execution', async () => {
    ctx.job.outputs = {
      ios_build_type: 'simulator',
    };

    await runCustomBuildAsync(ctx);

    expect(uploadJobOutputsToWwwAsyncMock).toHaveBeenCalledWith(expect.anything(), {
      logger: ctx.logger,
      expoApiV2BaseUrl: undefined,
    });
  });

  it('calls findAndUploadXcodeBuildLogsAsync in an iOS job if its artifacts is empty', async () => {
    await runCustomBuildAsync(ctx);
    expect(findAndUploadXcodeBuildLogsAsyncMock).toHaveBeenCalled();
  });

  it('does not call findAndUploadXcodeBuildLogsAsync in an iOS job if artifacts is already present', async () => {
    ctx.artifacts.XCODE_BUILD_LOGS = 'uploaded';
    await runCustomBuildAsync(ctx);
    expect(findAndUploadXcodeBuildLogsAsyncMock).not.toHaveBeenCalled();
  });

  it('retries checking out the project', async () => {
    jest.mocked(prepareProjectSourcesAsync).mockImplementationOnce(async () => {
      throw new Error('Failed to clone repository');
    });

    await runCustomBuildAsync(ctx);

    expect(prepareProjectSourcesAsync).toHaveBeenCalledTimes(2);
  });

  it('awaits drainPendingMetricUploads after workflow execution', async () => {
    let resolveDrain!: () => void;
    const drainSpy = jest
      .spyOn(CustomBuildContext.prototype, 'drainPendingMetricUploads')
      .mockReturnValue(
        new Promise<void>(resolve => {
          resolveDrain = resolve;
        })
      );

    let resolved = false;
    const resultPromise = runCustomBuildAsync(ctx).then(() => {
      resolved = true;
    });

    await new Promise(r => setImmediate(r));
    expect(resolved).toBe(false);

    resolveDrain();
    await resultPromise;
    expect(resolved).toBe(true);

    drainSpy.mockRestore();
  });

  it('awaits drainPendingMetricUploads even when workflow throws', async () => {
    let resolveDrain!: () => void;
    const drainSpy = jest
      .spyOn(CustomBuildContext.prototype, 'drainPendingMetricUploads')
      .mockReturnValue(
        new Promise<void>(resolve => {
          resolveDrain = resolve;
        })
      );

    const executeSpy = jest
      .spyOn(BuildWorkflow.prototype, 'executeAsync')
      .mockRejectedValue(new Error('workflow failed'));

    let rejected = false;
    const resultPromise = runCustomBuildAsync(ctx).catch(err => {
      rejected = true;
      throw err;
    });

    await new Promise(r => setImmediate(r));
    expect(rejected).toBe(false);

    resolveDrain();
    await expect(resultPromise).rejects.toThrow('workflow failed');
    expect(rejected).toBe(true);

    drainSpy.mockRestore();
    executeSpy.mockRestore();
  });

  it('attempts to upload job outputs when workflow execution throws', async () => {
    ctx.job.outputs = {
      ios_build_type: '${{ failure() }}',
    };

    const executeSpy = jest
      .spyOn(BuildWorkflow.prototype, 'executeAsync')
      .mockRejectedValue(new Error('workflow failed'));

    await expect(runCustomBuildAsync(ctx)).rejects.toThrow('workflow failed');
    expect(uploadJobOutputsToWwwAsyncMock).toHaveBeenCalledWith(expect.anything(), {
      logger: ctx.logger,
      expoApiV2BaseUrl: undefined,
    });

    executeSpy.mockRestore();
  });
});
