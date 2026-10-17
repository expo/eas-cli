import RudderAnalytics from '@expo/rudder-sdk-node';

import UserSettings from '../../user/UserSettings';
import { createAnalyticsAsync } from '../../analytics/AnalyticsManager';
import { AnalyticsExposureLogger } from '../AnalyticsExposureLogger';
import { createMockAnalytics } from './fixtures';

const mockIdentify = jest.fn();
const mockTrack = jest.fn();
const mockFlush = jest.fn();

jest.mock('@expo/rudder-sdk-node', () =>
  jest.fn().mockImplementation(() => ({
    identify: mockIdentify,
    track: mockTrack,
    flush: mockFlush,
  }))
);
jest.mock('../../user/UserSettings', () => ({
  __esModule: true,
  default: {
    deleteKeyAsync: jest.fn(),
    getAsync: jest.fn(),
    setAsync: jest.fn(),
  },
}));
jest.mock('../../analytics/agent', () => ({ getAgentTelemetryContext: jest.fn() }));
jest.mock('../../analytics/sandbox', () => ({ getSandboxTelemetryContext: jest.fn() }));

const originalDisableEasAnalytics = process.env.DISABLE_EAS_ANALYTICS;
const originalHttpsProxy = process.env.https_proxy;

afterAll(() => {
  if (originalDisableEasAnalytics === undefined) {
    delete process.env.DISABLE_EAS_ANALYTICS;
  } else {
    process.env.DISABLE_EAS_ANALYTICS = originalDisableEasAnalytics;
  }
  if (originalHttpsProxy === undefined) {
    delete process.env.https_proxy;
  } else {
    process.env.https_proxy = originalHttpsProxy;
  }
});

const exposure = {
  name: 'cli-test',
  time: 1700000000,
  salt: 'cli-full.cli-test.cli-test',
};

describe(AnalyticsExposureLogger, () => {
  it('logs Experiment Viewed with experimentName, variationName, and unit', () => {
    const analytics = createMockAnalytics();
    new AnalyticsExposureLogger(analytics).logExposure({
      ...exposure,
      unit: ['account-1'],
      params: { variant: 'treatment' },
    });
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: 'cli-test',
      variationName: 'treatment',
      unit: 'account-1',
    });
  });

  it('never sends an undefined variationName', () => {
    const analytics = createMockAnalytics();
    new AnalyticsExposureLogger(analytics).logExposure({
      ...exposure,
      unit: ['account-1'],
      params: { enabled: true, count: 2 },
    });
    expect(analytics.logEvent).toHaveBeenCalledWith(
      'Experiment Viewed',
      expect.objectContaining({ variationName: JSON.stringify({ enabled: true, count: 2 }) })
    );
  });

  it('sends numeric units and variants as strings', () => {
    const analytics = createMockAnalytics();
    new AnalyticsExposureLogger(analytics).logExposure({
      ...exposure,
      unit: [42],
      params: { variant: 3 },
    });
    expect(analytics.logEvent).toHaveBeenCalledWith(
      'Experiment Viewed',
      expect.objectContaining({ unit: '42', variationName: '3' })
    );
  });

  it('reaches RudderStack with the CLI source and anonymous ID', async () => {
    jest.mocked(RudderAnalytics).mockClear();
    mockTrack.mockClear();
    jest
      .mocked(UserSettings.getAsync)
      .mockImplementation(async (key, defaultValue) =>
        key === 'analyticsDeviceId' ? 'persistent-device-id' : defaultValue
      );
    delete process.env.DISABLE_EAS_ANALYTICS;
    delete process.env.https_proxy;

    const analytics = await createAnalyticsAsync();
    new AnalyticsExposureLogger(analytics).logExposure({
      ...exposure,
      unit: ['account-1'],
      params: { variant: 'treatment' },
    });

    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'Experiment Viewed',
        anonymousId: 'persistent-device-id',
        properties: expect.objectContaining({
          experimentName: 'cli-test',
          variationName: 'treatment',
          unit: 'account-1',
          source: 'eas cli',
        }),
      })
    );
  });
});
