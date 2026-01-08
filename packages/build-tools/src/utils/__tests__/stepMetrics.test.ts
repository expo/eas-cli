import { randomUUID } from 'crypto';

import { StepMetricsCollection } from '@expo/steps';

import { uploadStepMetricsToWwwAsync } from '../stepMetrics';
import { turtleFetch } from '../turtleFetch';

jest.mock('../turtleFetch');
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
