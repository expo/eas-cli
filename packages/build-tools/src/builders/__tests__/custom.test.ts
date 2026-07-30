import { BuildJob } from '@expo/eas-build-job';
import { BuildWorkflow } from '@expo/steps';
import { vol } from 'memfs';

import { createTestIosJob } from '../../__tests__/utils/job';
import { createMockLogger } from '../../__tests__/utils/logger';
import { prepareProjectSourcesAsync } from '../../common/projectSources';
import { BuildContext } from '../../context';
import { CustomBuildContext } from '../../customBuildContext';
import { Datadog } from '../../datadog';
import { findAndUploadXcodeBuildLogsAsync } from '../../ios/xcodeBuildLogs';
import { runCustomBuildAsync } from '../custom';

jest.mock('../../common/projectSources');
jest.mock('../../ios/xcodeBuildLogs');

const findAndUploadXcodeBuildLogsAsyncMock = jest.mocked(findAndUploadXcodeBuildLogsAsync);

describe(runCustomBuildAsync, () => {
  let ctx: BuildContext<BuildJob>;
  const datadogLogSpy = jest.spyOn(Datadog, 'log');

  beforeEach(() => {
    const job = createTestIosJob();

    jest.mocked(prepareProjectSourcesAsync).mockImplementation(async () => {
      vol.mkdirSync('/workingdir/env', { recursive: true });
      vol.mkdirSync('/workingdir/temporary-custom-build', { recursive: true });
      vol.fromJSON(
        {
          'test.yaml': `
          functions:
            test_function:
              name: Test function
              path: ./custom-function
              shell: /bin/zsh
              supported_platforms:
                - darwin
                - linux
              inputs:
                - name
                - profile
              outputs:
                - artifact_path
          build:
            steps:
              - eas/checkout
          `,
          'custom-function/package.json': '{}',
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

  it('reports user-provided custom functions when parsing the custom build config', async () => {
    await runCustomBuildAsync(ctx);

    expect(datadogLogSpy).toHaveBeenCalledWith('Custom build saw user-provided function', {
      event: 'custom_build_user_provided_function',
      custom_function_id: 'test_function',
      custom_function_input_count: '2',
      custom_function_module_path: '/workingdir/temporary-custom-build/custom-function',
      custom_function_name: 'Test function',
      custom_function_output_count: '1',
      custom_function_shell: '/bin/zsh',
      custom_function_supported_runtime_platforms: 'darwin,linux',
    });
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

  describe('with inline job steps (StepsConfigParser path)', () => {
    let executeSpy: jest.SpyInstance;

    function createStepsCtx(steps: unknown[]): BuildContext<BuildJob> {
      const job = createTestIosJob();
      return new BuildContext(
        {
          ...job,
          steps,
        } as unknown as BuildJob,
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
    }

    beforeEach(() => {
      executeSpy = jest.spyOn(BuildWorkflow.prototype, 'executeAsync').mockResolvedValue(undefined);
    });

    afterEach(() => {
      executeSpy.mockRestore();
    });

    it('builds the composite function catalog and resolves a local composite function referenced by a step', async () => {
      jest.mocked(prepareProjectSourcesAsync).mockImplementation(async () => {
        vol.mkdirSync('/workingdir/env', { recursive: true });
        vol.fromJSON(
          {
            '.eas/functions/hello/function.yml': `
            name: Hello
            runs:
              steps:
                - run: echo "hello from composite function"
            `,
          },
          '/workingdir/temporary-custom-build'
        );
        return { handled: true };
      });

      const stepsCtx = createStepsCtx([{ uses: './.eas/functions/hello', id: 'hello' }]);

      await expect(runCustomBuildAsync(stepsCtx)).resolves.toBeDefined();
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });

    it('fails to parse when a referenced local composite function does not exist', async () => {
      jest.mocked(prepareProjectSourcesAsync).mockImplementation(async () => {
        vol.mkdirSync('/workingdir/env', { recursive: true });
        vol.mkdirSync('/workingdir/temporary-custom-build', { recursive: true });
        return { handled: true };
      });

      const stepsCtx = createStepsCtx([{ uses: './.eas/functions/missing', id: 'missing' }]);

      await expect(runCustomBuildAsync(stepsCtx)).rejects.toThrow();
      expect(executeSpy).not.toHaveBeenCalled();
    });
  });
});
