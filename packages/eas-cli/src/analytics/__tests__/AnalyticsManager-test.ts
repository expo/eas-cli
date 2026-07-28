import RudderAnalytics from '@expo/rudder-sdk-node';

import UserSettings from '../../user/UserSettings';
import { CommandEvent, createAnalyticsAsync } from '../AnalyticsManager';
import { getAgentTelemetryContext } from '../agent';

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

jest.mock('../agent', () => ({
  getAgentTelemetryContext: jest.fn(),
}));

const getAgentTelemetryContextMock = jest.mocked(getAgentTelemetryContext);
const userSettingsMock = jest.mocked(UserSettings);

const originalHttpsProxy = process.env.https_proxy;
const originalDisableEasAnalytics = process.env.DISABLE_EAS_ANALYTICS;

beforeEach(() => {
  mockIdentify.mockClear();
  mockTrack.mockClear();
  mockFlush.mockClear();
  jest.mocked(RudderAnalytics).mockClear();
  getAgentTelemetryContextMock.mockReset();
  getAgentTelemetryContextMock.mockReturnValue(null);
  userSettingsMock.getAsync.mockImplementation(async (key, defaultValue) => {
    if (key === 'analyticsDeviceId') {
      return 'persistent-device-id';
    }

    return defaultValue;
  });
  userSettingsMock.setAsync.mockResolvedValue({});
  userSettingsMock.deleteKeyAsync.mockResolvedValue({});
  delete process.env.https_proxy;
  delete process.env.DISABLE_EAS_ANALYTICS;
});

afterAll(() => {
  if (originalHttpsProxy === undefined) {
    delete process.env.https_proxy;
  } else {
    process.env.https_proxy = originalHttpsProxy;
  }
  if (originalDisableEasAnalytics === undefined) {
    delete process.env.DISABLE_EAS_ANALYTICS;
  } else {
    process.env.DISABLE_EAS_ANALYTICS = originalDisableEasAnalytics;
  }
});

it('omits agent context when no agent is detected', async () => {
  const analytics = await createAnalyticsAsync();

  analytics.logEvent(CommandEvent.ACTION, { action: 'eas build' });

  expect(mockTrack).toHaveBeenCalledWith(
    expect.objectContaining({
      context: expect.not.objectContaining({ agent: expect.anything() }),
    })
  );
});

it('adds detected agent context to analytics events', async () => {
  getAgentTelemetryContextMock.mockReturnValue({ id: 'codex', sessionId: 'zzz' });
  const analytics = await createAnalyticsAsync();

  analytics.logEvent(CommandEvent.ACTION, { action: 'eas build' });

  expect(mockTrack).toHaveBeenCalledWith(
    expect.objectContaining({
      context: expect.objectContaining({
        agent: {
          id: 'codex',
          sessionId: 'zzz',
        },
      }),
    })
  );
});
