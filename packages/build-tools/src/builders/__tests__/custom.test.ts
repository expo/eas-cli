import { BuildJob } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { runCustomBuildAsync } from '../custom';
import { BuildContext } from '../../context';
import { createMockLogger } from '../../__tests__/utils/logger';
import { createTestIosJob } from '../../__tests__/utils/job';
import { findAndUploadXcodeBuildLogsAsync } from '../../ios/xcodeBuildLogs';
import { prepareProjectSourcesAsync } from '../../common/projectSources';

jest.mock('../../common/projectSources');
jest.mock('../../ios/xcodeBuildLogs');

const findAndUploadXcodeBuildLogsAsyncMock = jest.mocked(findAndUploadXcodeBuildLogsAsync);

describe(runCustomBuildAsync, () => {
  let ctx: BuildContext<BuildJob>;

  beforeEach(() => {
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
});
