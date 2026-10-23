import { Android } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { createTestAndroidJob } from '../../__tests__/utils/job';
import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { maybeFindAndUploadBuildArtifacts } from '../../utils/artifacts';
import { Hook, runHookIfPresent } from '../../utils/hooks';
import { uploadJobOutputsFromBuildContextAsync } from '../../utils/outputs';
import { runBuilderWithHooksAsync } from '../common';

jest.mock('../../ios/xcodeBuildLogs');
jest.mock('../../utils/artifacts');
jest.mock('../../utils/hooks', () => ({
  Hook: {
    ON_BUILD_SUCCESS: 'on-build-success',
    ON_BUILD_ERROR: 'on-build-error',
    ON_BUILD_COMPLETE: 'on-build-complete',
  },
  runHookIfPresent: jest.fn(),
}));
jest.mock('../../utils/outputs');

const maybeFindAndUploadBuildArtifactsMock = jest.mocked(maybeFindAndUploadBuildArtifacts);
const runHookIfPresentMock = jest.mocked(runHookIfPresent);
const uploadJobOutputsFromBuildContextAsyncMock = jest.mocked(
  uploadJobOutputsFromBuildContextAsync
);

describe(runBuilderWithHooksAsync, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    vol.fromJSON(
      {
        '/workingdir/env/.gitkeep': '',
        '/workingdir/build/package.json': '{}',
      },
      '/'
    );
  });

  it('uploads job outputs after a successful build', async () => {
    const ctx = createBuildContext({
      outputs: {
        android_build_type: 'apk',
      },
    });
    const buildAsync = jest.fn().mockResolvedValue(undefined);

    await runBuilderWithHooksAsync(ctx, buildAsync);

    expect(uploadJobOutputsFromBuildContextAsyncMock).toHaveBeenCalledWith(ctx, {
      logger: expect.anything(),
      buildSucceeded: true,
    });
    expect(maybeFindAndUploadBuildArtifactsMock).toHaveBeenCalled();
  });

  it('attempts to upload job outputs after a failed build', async () => {
    const ctx = createBuildContext({
      outputs: {
        failed: '${{ failure() }}',
      },
    });
    const buildAsync = jest.fn().mockRejectedValue(new Error('build failed'));

    await expect(runBuilderWithHooksAsync(ctx, buildAsync)).rejects.toThrow('build failed');

    expect(uploadJobOutputsFromBuildContextAsyncMock).toHaveBeenCalledWith(ctx, {
      logger: expect.anything(),
      buildSucceeded: false,
    });
    expect(runHookIfPresentMock).toHaveBeenCalled();
  });

  it.each(['artifact upload', 'completion hook'])(
    'attempts to upload job outputs after a %s failure',
    async failure => {
      const ctx = createBuildContext({
        outputs: {
          failed: '${{ failure() }}',
        },
      });
      const buildAsync = jest.fn().mockResolvedValue(undefined);
      if (failure === 'completion hook') {
        runHookIfPresentMock.mockImplementation(async (_ctx, hook) => {
          if (hook === Hook.ON_BUILD_COMPLETE) {
            throw new Error('completion hook failed');
          }
        });
      } else {
        maybeFindAndUploadBuildArtifactsMock.mockRejectedValue(new Error('artifact upload failed'));
      }

      await expect(runBuilderWithHooksAsync(ctx, buildAsync)).rejects.toThrow(
        failure === 'completion hook' ? 'Build complete hook' : 'Upload build artifacts'
      );

      expect(uploadJobOutputsFromBuildContextAsyncMock).toHaveBeenCalledWith(ctx, {
        logger: expect.anything(),
        buildSucceeded: false,
      });
    }
  );
});

function createBuildContext(jobOverrides: Partial<Android.Job> = {}): BuildContext<Android.Job> {
  return new BuildContext<Android.Job>(
    {
      ...createTestAndroidJob(),
      ...jobOverrides,
    },
    {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      env: {
        __API_SERVER_URL: 'http://api.expo.test',
        __WORKFLOW_JOB_ID: 'test-workflow-job-id',
      },
      uploadArtifact: jest.fn(),
      expoApiV2BaseUrl: 'http://exp.test/--/api/v2/',
    }
  );
}
