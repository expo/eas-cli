import { StepMetric, StepMetricsCollection } from '@expo/steps';
import { randomUUID } from 'crypto';

import { uploadStepMetricToWwwAsync, uploadStepMetricsToWwwAsync } from '../stepMetrics';
import { TurtleFetchError, turtleFetch } from '../turtleFetch';
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

  it('uploads step metrics to www', async () => {
    const stepMetrics: StepMetricsCollection = [
      { metricsId: 'eas/checkout', result: 'success', durationMs: 1000, platform: 'linux' },
      {
        metricsId: 'eas/install_node_modules',
        result: 'failed',
        durationMs: 5000,
        platform: 'linux',
      },
    ];

    await uploadStepMetricsToWwwAsync({
      workflowJobId,
      robotAccessToken,
      expoApiV2BaseUrl,
      stepMetrics,
      logger: mockLogger,
    });

    expect(mockTurtleFetch).toHaveBeenCalledWith(
      `${expoApiV2BaseUrl}workflows/${workflowJobId}/metrics`,
      'POST',
      expect.objectContaining({
        json: { stepMetrics },
        headers: { Authorization: `Bearer ${robotAccessToken}` },
      })
    );
  });

  it('does nothing when stepMetrics is empty', async () => {
    await uploadStepMetricsToWwwAsync({
      workflowJobId,
      robotAccessToken,
      expoApiV2BaseUrl,
      stepMetrics: [],
      logger: mockLogger,
    });

    expect(mockTurtleFetch).not.toHaveBeenCalled();
  });
});

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

  it('retries on transient failure then succeeds', async () => {
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

  it('silently catches after all retries exhausted', async () => {
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

  it('does not retry on non-retryable HTTP errors (e.g. 403)', async () => {
    const mockResponse = { status: 403, ok: false } as any;
    mockTurtleFetch.mockRejectedValue(new TurtleFetchError('Forbidden', mockResponse));

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
    expect(sleepAsync).not.toHaveBeenCalled();
  });

  it('retries on 408 Request Timeout', async () => {
    const mockResponse = { status: 408, ok: false } as any;
    mockTurtleFetch
      .mockRejectedValueOnce(new TurtleFetchError('Request Timeout', mockResponse))
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

  it('retries on 429 Too Many Requests', async () => {
    const mockResponse = { status: 429, ok: false } as any;
    mockTurtleFetch
      .mockRejectedValueOnce(new TurtleFetchError('Too Many Requests', mockResponse))
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
});
