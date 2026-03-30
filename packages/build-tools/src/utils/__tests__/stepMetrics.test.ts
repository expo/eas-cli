import { StepMetric } from '@expo/steps';
import { randomUUID } from 'crypto';

import { uploadStepMetricsToWwwAsync } from '../stepMetrics';
import { turtleFetch } from '../turtleFetch';

jest.mock('../turtleFetch', () => ({
  ...jest.requireActual('../turtleFetch'),
  turtleFetch: jest.fn(),
}));
const mockTurtleFetch = turtleFetch as jest.MockedFunction<typeof turtleFetch>;

describe(uploadStepMetricsToWwwAsync, () => {
  const workflowJobId = randomUUID();
  const robotAccessToken = 'test-token';
  const expoApiV2BaseUrl = 'http://exp.test/--/api/v2/';

  const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploads step metrics', async () => {
    const stepMetric: StepMetric = {
      metricsId: 'eas/checkout',
      result: 'success',
      durationMs: 1000,
      platform: 'linux',
    };

    await uploadStepMetricsToWwwAsync({
      workflowJobId,
      robotAccessToken,
      expoApiV2BaseUrl,
      stepMetrics: [stepMetric],
      logger: mockLogger,
    });

    expect(mockTurtleFetch).toHaveBeenCalledTimes(1);
    expect(mockTurtleFetch).toHaveBeenCalledWith(
      `${expoApiV2BaseUrl}workflows/${workflowJobId}/metrics`,
      'POST',
      expect.objectContaining({
        json: { stepMetrics: [stepMetric] },
        headers: { Authorization: `Bearer ${robotAccessToken}` },
        retries: 2,
      })
    );
  });

  it('silently gives up on failure', async () => {
    mockTurtleFetch.mockRejectedValue(new Error('persistent failure'));

    const stepMetric: StepMetric = {
      metricsId: 'eas/checkout',
      result: 'failed',
      durationMs: 500,
      platform: 'darwin',
    };

    await expect(
      uploadStepMetricsToWwwAsync({
        workflowJobId,
        robotAccessToken,
        expoApiV2BaseUrl,
        stepMetrics: [stepMetric],
        logger: mockLogger,
      })
    ).resolves.not.toThrow();
  });
});
