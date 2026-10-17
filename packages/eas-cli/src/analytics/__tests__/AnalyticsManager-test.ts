import RudderAnalytics from '@expo/rudder-sdk-node';

import UserSettings from '../../user/UserSettings';
import { CommandEvent, createAnalyticsAsync, isAnalyticsOptedOutAsync } from '../AnalyticsManager';
import { getAgentTelemetryContext } from '../agent';
import { getSandboxTelemetryContext } from '../sandbox';

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
jest.mock('../sandbox', () => ({
  getSandboxTelemetryContext: jest.fn(),
}));

const getAgentTelemetryContextMock = jest.mocked(getAgentTelemetryContext);
const getSandboxTelemetryContextMock = jest.mocked(getSandboxTelemetryContext);
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
  getSandboxTelemetryContextMock.mockReset();
  getSandboxTelemetryContextMock.mockReturnValue(null);
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

it('omits agent and sandbox context when neither is detected', async () => {
  const analytics = await createAnalyticsAsync();

  analytics.logEvent(CommandEvent.ACTION, { action: 'eas build' });

  expect(mockTrack).toHaveBeenCalledWith(
    expect.objectContaining({
      context: expect.not.objectContaining({
        agent: expect.anything(),
        sandbox_provider: expect.anything(),
      }),
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

it('adds detected sandbox context to analytics events', async () => {
  getSandboxTelemetryContextMock.mockReturnValue('e2b');
  const analytics = await createAnalyticsAsync();

  analytics.logEvent(CommandEvent.ACTION, { action: 'eas build' });

  expect(mockTrack).toHaveBeenCalledWith(
    expect.objectContaining({
      context: expect.objectContaining({
        sandbox_provider: 'e2b',
      }),
    })
  );
});

describe(isAnalyticsOptedOutAsync, () => {
  it('is false by default', async () => {
    await expect(isAnalyticsOptedOutAsync()).resolves.toBe(false);
  });

  it('is true when DISABLE_EAS_ANALYTICS is set', async () => {
    process.env.DISABLE_EAS_ANALYTICS = '1';
    await expect(isAnalyticsOptedOutAsync()).resolves.toBe(true);
  });

  it('is true when analytics were turned off with eas analytics off', async () => {
    userSettingsMock.getAsync.mockImplementation(async (key, defaultValue) =>
      key === 'analyticsEnabled' ? false : defaultValue
    );
    await expect(isAnalyticsOptedOutAsync()).resolves.toBe(true);
  });
});

describe('getDeviceId', () => {
  // Backs UserSettings with an in-memory store so a value written by createAnalyticsAsync is read back.
  function useInMemoryUserSettings(initial: Record<string, unknown>): void {
    const stored: Record<string, unknown> = { ...initial };
    (userSettingsMock.setAsync as jest.Mock).mockImplementation(
      async (key: string, value: unknown) => {
        stored[key] = value;
        return {};
      }
    );
    (userSettingsMock.getAsync as jest.Mock).mockImplementation(
      async (key: string, defaultValue: unknown) => (key in stored ? stored[key] : defaultValue)
    );
  }

  it('returns the persisted analytics device ID', async () => {
    const analytics = await createAnalyticsAsync();
    expect(analytics.getDeviceId()).toBe('persistent-device-id');
  });

  it('creates and persists a device ID when none is stored', async () => {
    userSettingsMock.getAsync.mockImplementation(async (key, defaultValue) =>
      key === 'analyticsDeviceId' ? null : defaultValue
    );
    const analytics = await createAnalyticsAsync();
    const deviceId = analytics.getDeviceId();
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(userSettingsMock.setAsync).toHaveBeenCalledWith('analyticsDeviceId', deviceId);
  });

  it('is null when DISABLE_EAS_ANALYTICS is set', async () => {
    useInMemoryUserSettings({ analyticsDeviceId: 'persistent-device-id' });
    process.env.DISABLE_EAS_ANALYTICS = '1';
    const analytics = await createAnalyticsAsync();
    expect(analytics.getDeviceId()).toBeNull();
  });

  it('is null when running behind https_proxy', async () => {
    process.env.https_proxy = 'http://proxy.local:8080';
    const analytics = await createAnalyticsAsync();
    expect(analytics.getDeviceId()).toBeNull();
  });

  it('is null when analytics were turned off with eas analytics off', async () => {
    userSettingsMock.getAsync.mockImplementation(async (key, defaultValue) =>
      key === 'analyticsEnabled' ? false : defaultValue
    );
    const analytics = await createAnalyticsAsync();
    expect(analytics.getDeviceId()).toBeNull();
  });
});
