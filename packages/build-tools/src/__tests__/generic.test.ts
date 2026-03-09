import { BuildPhase } from '@expo/eas-build-job';
import { BuildStepGlobalContext, StepsConfigParser } from '@expo/steps';

import { runGenericJobAsync } from '../generic';
import { CustomBuildContext } from '../customBuildContext';
import { uploadJobOutputsToWwwAsync } from '../utils/outputs';
import { uploadStepMetricToWwwAsync } from '../utils/stepMetrics';

jest.mock('../customBuildContext');
jest.mock('../utils/outputs');
jest.mock('../utils/stepMetrics');
jest.mock('../common/projectSources');
jest.mock('../steps/easFunctions', () => ({ getEasFunctions: jest.fn().mockReturnValue([]) }));
jest.mock('../steps/easFunctionGroups', () => ({
  getEasFunctionGroups: jest.fn().mockReturnValue([]),
}));
jest.mock('@expo/steps');
jest.mock('fs/promises');

const mockUploadStepMetricToWwwAsync = jest.mocked(uploadStepMetricToWwwAsync);
const mockUploadJobOutputsToWwwAsync = jest.mocked(uploadJobOutputsToWwwAsync);

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe(runGenericJobAsync, () => {
  const expoApiV2BaseUrl = 'http://exp.test/--/api/v2/';

  let capturedOnStepMetricCollected: ((metric: any) => void) | undefined;
  let mockCtx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnStepMetricCollected = undefined;

    (CustomBuildContext as unknown as jest.Mock).mockImplementation(() => ({
      projectSourceDirectory: '/tmp/src',
      env: { __WORKFLOW_JOB_ID: 'test-workflow-job-id' },
    }));

    (BuildStepGlobalContext as unknown as jest.Mock).mockImplementation(() => {
      const instance: any = {
        env: { __WORKFLOW_JOB_ID: 'test-workflow-job-id' },
      };
      Object.defineProperty(instance, 'onStepMetricCollected', {
        get: () => capturedOnStepMetricCollected,
        set: (fn: any) => {
          capturedOnStepMetricCollected = fn;
        },
        enumerable: true,
        configurable: true,
      });
      return instance;
    });

    mockCtx = {
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
    };

    mockUploadStepMetricToWwwAsync.mockResolvedValue(undefined);
    mockUploadJobOutputsToWwwAsync.mockResolvedValue(undefined);
  });

  it('injects onStepMetricCollected callback when credentials exist', async () => {
    const mockWorkflow = {
      executeAsync: jest.fn(async () => {
        capturedOnStepMetricCollected?.({
          metricsId: 'eas/checkout',
          result: 'success',
          durationMs: 100,
          platform: 'linux',
        });
      }),
    };
    (StepsConfigParser as unknown as jest.Mock).mockImplementation(() => ({
      parseAsync: jest.fn().mockResolvedValue(mockWorkflow),
    }));

    await runGenericJobAsync(mockCtx, { expoApiV2BaseUrl });

    expect(capturedOnStepMetricCollected).toBeDefined();
    expect(mockUploadStepMetricToWwwAsync).toHaveBeenCalledTimes(1);
    expect(mockUploadStepMetricToWwwAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowJobId: 'test-workflow-job-id',
        robotAccessToken: 'test-token',
        expoApiV2BaseUrl,
      })
    );
  });

  it('does not inject callback when workflowJobId is missing', async () => {
    (CustomBuildContext as unknown as jest.Mock).mockImplementation(() => ({
      projectSourceDirectory: '/tmp/src',
      env: {},
    }));
    (BuildStepGlobalContext as unknown as jest.Mock).mockImplementation(() => {
      const instance: any = { env: {} };
      Object.defineProperty(instance, 'onStepMetricCollected', {
        get: () => capturedOnStepMetricCollected,
        set: (fn: any) => {
          capturedOnStepMetricCollected = fn;
        },
        enumerable: true,
        configurable: true,
      });
      return instance;
    });
    const mockWorkflow = { executeAsync: jest.fn().mockResolvedValue(undefined) };
    (StepsConfigParser as unknown as jest.Mock).mockImplementation(() => ({
      parseAsync: jest.fn().mockResolvedValue(mockWorkflow),
    }));

    await runGenericJobAsync(mockCtx, { expoApiV2BaseUrl });

    expect(capturedOnStepMetricCollected).toBeUndefined();
    expect(mockUploadStepMetricToWwwAsync).not.toHaveBeenCalled();
  });

  it('drain waits for pending upload before runGenericJobAsync resolves', async () => {
    const deferred = createDeferred<void>();
    mockUploadStepMetricToWwwAsync.mockReturnValue(deferred.promise);

    const mockWorkflow = {
      executeAsync: jest.fn(async () => {
        capturedOnStepMetricCollected?.({
          metricsId: 'eas/checkout',
          result: 'success',
          durationMs: 100,
          platform: 'linux',
        });
      }),
    };
    (StepsConfigParser as unknown as jest.Mock).mockImplementation(() => ({
      parseAsync: jest.fn().mockResolvedValue(mockWorkflow),
    }));

    let resolved = false;
    const resultPromise = runGenericJobAsync(mockCtx, { expoApiV2BaseUrl }).then(() => {
      resolved = true;
    });

    await new Promise(r => setImmediate(r));
    expect(resolved).toBe(false);

    deferred.resolve();
    await resultPromise;
    expect(resolved).toBe(true);
  });

  it('drain runs even when outputs upload fails', async () => {
    const deferred = createDeferred<void>();
    mockUploadStepMetricToWwwAsync.mockReturnValue(deferred.promise);
    mockUploadJobOutputsToWwwAsync.mockRejectedValue(new Error('outputs upload failed'));

    const mockWorkflow = {
      executeAsync: jest.fn(async () => {
        capturedOnStepMetricCollected?.({
          metricsId: 'eas/checkout',
          result: 'success',
          durationMs: 100,
          platform: 'linux',
        });
      }),
    };
    (StepsConfigParser as unknown as jest.Mock).mockImplementation(() => ({
      parseAsync: jest.fn().mockResolvedValue(mockWorkflow),
    }));

    let rejected = false;
    const resultPromise = runGenericJobAsync(mockCtx, { expoApiV2BaseUrl }).catch(err => {
      rejected = true;
      throw err;
    });

    await new Promise(r => setImmediate(r));
    expect(rejected).toBe(false);

    deferred.resolve();
    await expect(resultPromise).rejects.toThrow('outputs upload failed');
    expect(rejected).toBe(true);
  });
});
