import { StepMetric } from '@expo/steps';
import { randomUUID } from 'crypto';

import { uploadStepMetricToWwwAsync } from '../stepMetrics';
import { turtleFetch } from '../turtleFetch';
import { sleepAsync } from '../retry';

jest.mock('../turtleFetch', () => ({
  ...jest.requireActual('../turtleFetch'),
  turtleFetch: jest.fn(),
}));
jest.mock('../retry', () => ({
  ...jest.requireActual('../retry'),
  sleepAsync: jest.fn().mockResolvedValue(undefined),
}));
const mockTurtleFetch = turtleFetch as jest.MockedFunction<typeof turtleFetch>;

describe(uploadStepMetricToWwwAsync, () => {
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

  it('uploads a single step metric', async () => {
    const stepMetric: StepMetric = {
      metricsId: 'eas/checkout',
      result: 'success',
      durationMs: 1000,
      platform: 'linux',
    };

    await uploadStepMetricToWwwAsync({
      workflowJobId,
      robotAccessToken,
      expoApiV2BaseUrl,
      stepMetric,
      logger: mockLogger,
    });

    expect(mockTurtleFetch).toHaveBeenCalledTimes(1);
    expect(mockTurtleFetch).toHaveBeenCalledWith(
      `${expoApiV2BaseUrl}workflows/${workflowJobId}/metrics`,
      'POST',
      expect.objectContaining({
        json: { stepMetrics: [stepMetric] },
        headers: { Authorization: `Bearer ${robotAccessToken}` },
      })
    );
  });

  it('retries on failure then succeeds', async () => {
    mockTurtleFetch
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(undefined as any);

    const stepMetric: StepMetric = {
      metricsId: 'eas/checkout',
      result: 'success',
      durationMs: 1000,
      platform: 'linux',
    };

    await uploadStepMetricToWwwAsync({
      workflowJobId,
      robotAccessToken,
      expoApiV2BaseUrl,
      stepMetric,
      logger: mockLogger,
    });

    expect(mockTurtleFetch).toHaveBeenCalledTimes(2);
  });

  it('silently gives up after all retries exhausted', async () => {
    mockTurtleFetch.mockRejectedValue(new Error('persistent failure'));

    const stepMetric: StepMetric = {
      metricsId: 'eas/checkout',
      result: 'failed',
      durationMs: 500,
      platform: 'darwin',
    };

    await uploadStepMetricToWwwAsync({
      workflowJobId,
      robotAccessToken,
      expoApiV2BaseUrl,
      stepMetric,
      logger: mockLogger,
    });

    // 1 initial + 2 retries = 3 total calls
    expect(mockTurtleFetch).toHaveBeenCalledTimes(3);
    expect(sleepAsync).toHaveBeenCalledTimes(2);
  });
});
