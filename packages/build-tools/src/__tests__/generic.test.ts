import { BuildPhase } from '@expo/eas-build-job';
import { BuildStepGlobalContext, StepsConfigParser } from '@expo/steps';

import { runGenericJobAsync } from '../generic';
import { CustomBuildContext } from '../customBuildContext';
import { uploadJobOutputsToWwwAsync } from '../utils/outputs';
import { stopLocalEgressResourcesAsync } from '../steps/utils/localEgress';

jest.mock('../customBuildContext');
jest.mock('../utils/outputs');
jest.mock('../steps/utils/localEgress', () => ({ stopLocalEgressResourcesAsync: jest.fn() }));
jest.mock('../common/projectSources');
jest.mock('../steps/easFunctions', () => ({ getEasFunctions: jest.fn().mockReturnValue([]) }));
jest.mock('../steps/easFunctionGroups', () => ({
  getEasFunctionGroups: jest.fn().mockReturnValue([]),
}));
jest.mock('@expo/steps');
jest.mock('fs/promises');

const mockUploadJobOutputsToWwwAsync = jest.mocked(uploadJobOutputsToWwwAsync);

describe(runGenericJobAsync, () => {
  const expoApiV2BaseUrl = 'http://exp.test/--/api/v2/';

  let mockDrainPendingMetricUploads: jest.Mock;
  let mockCtx: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDrainPendingMetricUploads = jest.fn().mockResolvedValue(undefined);

    (CustomBuildContext as unknown as jest.Mock).mockImplementation(() => ({
      projectSourceDirectory: '/tmp/src',
      env: { __WORKFLOW_JOB_ID: 'test-workflow-job-id' },
      drainPendingMetricUploads: mockDrainPendingMetricUploads,
    }));

    (BuildStepGlobalContext as unknown as jest.Mock).mockImplementation(() => ({
      env: { __WORKFLOW_JOB_ID: 'test-workflow-job-id' },
    }));

    mockCtx = {
      expoApiV2BaseUrl,
      job: {
        secrets: { robotAccessToken: 'test-token' },
        steps: [],
      },
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn().mockReturnThis(),
      },
      runBuildPhase: jest.fn(async (_phase: BuildPhase, fn: () => Promise<any>) => fn()),
      getReactNativeProjectDirectory: jest.fn(() => '/tmp/src'),
    };

    mockUploadJobOutputsToWwwAsync.mockResolvedValue(undefined);
  });

  it.each(['success', 'failure'])(
    'releases local egress after workflow %s, before uploading outputs',
    async outcome => {
      const executeAsync =
        outcome === 'success'
          ? jest.fn().mockResolvedValue(undefined)
          : jest.fn().mockRejectedValue(new Error(outcome));
      (StepsConfigParser as unknown as jest.Mock).mockImplementation(() => ({
        parseAsync: jest.fn().mockResolvedValue({ executeAsync }),
      }));
      const { runResult } = await runGenericJobAsync(mockCtx);
      expect(runResult.ok).toBe(outcome === 'success');
      expect(stopLocalEgressResourcesAsync).toHaveBeenCalledWith(mockCtx.logger);
      expect(jest.mocked(stopLocalEgressResourcesAsync).mock.invocationCallOrder[0]).toBeLessThan(
        mockUploadJobOutputsToWwwAsync.mock.invocationCallOrder[0]
      );
    }
  );

  it('awaits drainPendingMetricUploads in COMPLETE_JOB phase', async () => {
    const mockWorkflow = { executeAsync: jest.fn().mockResolvedValue(undefined) };
    (StepsConfigParser as unknown as jest.Mock).mockImplementation(() => ({
      parseAsync: jest.fn().mockResolvedValue(mockWorkflow),
    }));

    let resolveDrain!: () => void;
    mockDrainPendingMetricUploads.mockReturnValue(
      new Promise<void>(resolve => {
        resolveDrain = resolve;
      })
    );

    let resolved = false;
    const resultPromise = runGenericJobAsync(mockCtx).then(() => {
      resolved = true;
    });

    await new Promise(r => setImmediate(r));
    expect(resolved).toBe(false);

    resolveDrain();
    await resultPromise;
    expect(resolved).toBe(true);
  });

  it('awaits drainPendingMetricUploads even when outputs upload fails', async () => {
    const mockWorkflow = { executeAsync: jest.fn().mockResolvedValue(undefined) };
    (StepsConfigParser as unknown as jest.Mock).mockImplementation(() => ({
      parseAsync: jest.fn().mockResolvedValue(mockWorkflow),
    }));
    mockUploadJobOutputsToWwwAsync.mockRejectedValue(new Error('outputs upload failed'));

    let resolveDrain!: () => void;
    mockDrainPendingMetricUploads.mockReturnValue(
      new Promise<void>(resolve => {
        resolveDrain = resolve;
      })
    );

    let rejected = false;
    const resultPromise = runGenericJobAsync(mockCtx).catch(err => {
      rejected = true;
      throw err;
    });

    await new Promise(r => setImmediate(r));
    expect(rejected).toBe(false);

    resolveDrain();
    await expect(resultPromise).rejects.toThrow('outputs upload failed');
    expect(rejected).toBe(true);
  });

  it('passes the job hooks into the steps parser', async () => {
    // @expo/steps is fully mocked here — assert the plumbing only (real
    // insertion behavior is covered by the parser's own tests).
    const mockWorkflow = { executeAsync: jest.fn().mockResolvedValue(undefined) };
    (StepsConfigParser as unknown as jest.Mock).mockImplementation(() => ({
      parseAsync: jest.fn().mockResolvedValue(mockWorkflow),
    }));

    mockCtx.job.hooks = { before_install_node_modules: [{ run: 'echo hi' }] };
    await runGenericJobAsync(mockCtx);

    expect(StepsConfigParser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hooks: mockCtx.job.hooks })
    );
  });

  it('passes hooks: undefined into the steps parser for a hook-less job (dormancy)', async () => {
    const mockWorkflow = { executeAsync: jest.fn().mockResolvedValue(undefined) };
    (StepsConfigParser as unknown as jest.Mock).mockImplementation(() => ({
      parseAsync: jest.fn().mockResolvedValue(mockWorkflow),
    }));

    await runGenericJobAsync(mockCtx);

    expect(StepsConfigParser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hooks: undefined })
    );
  });

  it('throws before workflow execution when expoApiV2BaseUrl is missing', async () => {
    mockCtx.expoApiV2BaseUrl = undefined;

    const mockWorkflow = { executeAsync: jest.fn() };
    (StepsConfigParser as unknown as jest.Mock).mockImplementation(() => ({
      parseAsync: jest.fn().mockResolvedValue(mockWorkflow),
    }));

    await expect(runGenericJobAsync(mockCtx)).rejects.toThrow(
      'expoApiV2BaseUrl is required for generic jobs'
    );

    expect(CustomBuildContext).not.toHaveBeenCalled();
  });
});
