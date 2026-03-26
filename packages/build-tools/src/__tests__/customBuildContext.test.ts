import { BuildTrigger, Ios, Metadata } from '@expo/eas-build-job';
import { StepMetric } from '@expo/steps';

import { createTestIosJob } from './utils/job';
import { createMockLogger } from './utils/logger';
import { BuildContext } from '../context';
import { CustomBuildContext } from '../customBuildContext';
import { uploadStepMetricsToWwwAsync } from '../utils/stepMetrics';

jest.mock('../utils/stepMetrics');
const mockUploadStepMetricsToWwwAsync = jest.mocked(uploadStepMetricsToWwwAsync);

describe(CustomBuildContext, () => {
  it('should not lose workflowInterpolationContext', () => {
    const contextUploadArtifact = jest.fn();
    const ctx = new BuildContext(
      createTestIosJob({
        triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
        workflowInterpolationContext: {
          foo: 'bar',
        } as unknown as Ios.Job['workflowInterpolationContext'],
      }),
      {
        env: {
          __API_SERVER_URL: 'http://api.expo.test',
        },
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        logger: createMockLogger(),
        uploadArtifact: contextUploadArtifact,
        workingdir: '',
      }
    );
    const customContext = new CustomBuildContext(ctx);
    expect(customContext.job.workflowInterpolationContext).toStrictEqual({
      foo: 'bar',
    });
    customContext.updateJobInformation({} as Ios.Job, {} as Metadata);
    expect(customContext.job.workflowInterpolationContext).toStrictEqual({
      foo: 'bar',
    });
  });

  describe('reportStepMetric', () => {
    const expoApiV2BaseUrl = 'http://exp.test/--/api/v2/';
    const workflowJobId = 'test-workflow-job-id';
    const robotAccessToken = 'test-robot-token';

    const sampleMetric: StepMetric = {
      metricsId: 'eas/checkout',
      result: 'success',
      durationMs: 1000,
      platform: 'linux',
    };

    function createCustomBuildContext(
      overrides: {
        expoApiV2BaseUrl?: string | undefined;
        includeRobotAccessToken?: boolean;
        includeWorkflowJobId?: boolean;
      } = {}
    ): CustomBuildContext {
      const job = createTestIosJob();
      if (overrides.includeRobotAccessToken !== false) {
        (job.secrets as any).robotAccessToken = robotAccessToken;
      }

      const env: Record<string, string> = {
        __API_SERVER_URL: 'http://api.expo.test',
      };
      if (overrides.includeWorkflowJobId !== false) {
        env.__WORKFLOW_JOB_ID = workflowJobId;
      }

      const ctx = new BuildContext(job, {
        env,
        logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
        logger: createMockLogger(),
        uploadArtifact: jest.fn(),
        workingdir: '/workingdir',
        expoApiV2BaseUrl:
          'expoApiV2BaseUrl' in overrides ? overrides.expoApiV2BaseUrl : expoApiV2BaseUrl,
      });

      return new CustomBuildContext(ctx);
    }

    beforeEach(() => {
      jest.clearAllMocks();
      mockUploadStepMetricsToWwwAsync.mockResolvedValue(undefined);
    });

    it('calls uploadStepMetricsToWwwAsync when all required fields are present', () => {
      const customCtx = createCustomBuildContext();
      customCtx.reportStepMetric(sampleMetric);

      expect(mockUploadStepMetricsToWwwAsync).toHaveBeenCalledTimes(1);
      expect(mockUploadStepMetricsToWwwAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowJobId,
          robotAccessToken,
          expoApiV2BaseUrl,
          stepMetrics: [sampleMetric],
        })
      );
    });

    it('does not call upload when workflowJobId is missing', () => {
      const customCtx = createCustomBuildContext({ includeWorkflowJobId: false });
      customCtx.reportStepMetric(sampleMetric);

      expect(mockUploadStepMetricsToWwwAsync).not.toHaveBeenCalled();
    });

    it('does not call upload when robotAccessToken is missing', () => {
      const customCtx = createCustomBuildContext({ includeRobotAccessToken: false });
      customCtx.reportStepMetric(sampleMetric);

      expect(mockUploadStepMetricsToWwwAsync).not.toHaveBeenCalled();
    });

    it('does not call upload when expoApiV2BaseUrl is missing', () => {
      const customCtx = createCustomBuildContext({ expoApiV2BaseUrl: undefined });
      customCtx.reportStepMetric(sampleMetric);

      expect(mockUploadStepMetricsToWwwAsync).not.toHaveBeenCalled();
    });

    it('drainPendingMetricUploads awaits all pending uploads', async () => {
      let resolveUpload!: () => void;
      const uploadPromise = new Promise<void>(resolve => {
        resolveUpload = resolve;
      });
      mockUploadStepMetricsToWwwAsync.mockReturnValue(uploadPromise);

      const customCtx = createCustomBuildContext();
      customCtx.reportStepMetric(sampleMetric);

      let drained = false;
      const drainPromise = customCtx.drainPendingMetricUploads().then(() => {
        drained = true;
      });

      await new Promise(r => setImmediate(r));
      expect(drained).toBe(false);

      resolveUpload();
      await drainPromise;
      expect(drained).toBe(true);
    });

    it('drainPendingMetricUploads settles even if an upload rejects', async () => {
      mockUploadStepMetricsToWwwAsync.mockRejectedValue(new Error('upload failed'));

      const customCtx = createCustomBuildContext();
      customCtx.reportStepMetric(sampleMetric);

      await expect(customCtx.drainPendingMetricUploads()).resolves.not.toThrow();
    });
  });
});
