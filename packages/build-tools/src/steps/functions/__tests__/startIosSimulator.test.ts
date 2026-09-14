import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { configureSimulatorProxyEnvironmentAsync } from '../../utils/localEgress';
import { createStartIosSimulatorBuildFunction } from '../startIosSimulator';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../../utils/IosSimulatorUtils', () => ({
  IosSimulatorUtils: {
    getAvailableDevicesAsync: jest.fn(),
    getDeviceAsync: jest.fn(),
    cloneAsync: jest.fn(),
    enableAccessibilitySettingsAsync: jest.fn(),
    startAsync: jest.fn(),
    waitForReadyAsync: jest.fn(),
    disableApsdAsync: jest.fn(),
  },
}));

jest.mock('../../utils/localEgress', () => ({
  configureSimulatorProxyEnvironmentAsync: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);
const mockedUtils = jest.mocked(IosSimulatorUtils);
const mockedConfigureProxyEnvironment = jest.mocked(configureSimulatorProxyEnvironmentAsync);

function createStep(callInputs?: Record<string, unknown>) {
  const logger = createMockLogger();
  const fn = createStartIosSimulatorBuildFunction();
  const globalCtx = createGlobalContextMock({ logger });
  const step = fn.createBuildStepFromFunctionCall(globalCtx, { callInputs });
  return Object.assign(step, { logger });
}

describe(createStartIosSimulatorBuildFunction, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
    mockedUtils.getAvailableDevicesAsync.mockResolvedValue([]);
    mockedUtils.getDeviceAsync.mockResolvedValue(null);
    mockedUtils.cloneAsync.mockResolvedValue(undefined);
    mockedUtils.enableAccessibilitySettingsAsync.mockResolvedValue(undefined);
    mockedUtils.startAsync.mockResolvedValue({ udid: 'test-udid' as any });
    mockedUtils.waitForReadyAsync.mockResolvedValue(undefined);
    mockedUtils.disableApsdAsync.mockResolvedValue(undefined);
    mockedConfigureProxyEnvironment.mockResolvedValue(false);
  });

  it('does not enable accessibility settings by default', async () => {
    await createStep({ device_identifier: 'iPhone 15' }).executeAsync();

    expect(mockedUtils.enableAccessibilitySettingsAsync).not.toHaveBeenCalled();
    expect(mockedUtils.startAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'iPhone 15',
      env: expect.any(Object),
    });
  });

  it('enables accessibility settings before starting the main device and every clone when requested', async () => {
    mockedUtils.startAsync
      .mockResolvedValueOnce({ udid: 'base' as any })
      .mockResolvedValueOnce({ udid: 'clone-1' as any })
      .mockResolvedValueOnce({ udid: 'clone-2' as any });

    await createStep({
      device_identifier: 'iPhone 15',
      count: 2,
      enable_accessibility_settings: true,
    }).executeAsync();

    expect(mockedUtils.enableAccessibilitySettingsAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'iPhone 15',
      env: expect.any(Object),
    });
    expect(mockedUtils.enableAccessibilitySettingsAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'eas-simulator-1',
      env: expect.any(Object),
    });
    expect(mockedUtils.enableAccessibilitySettingsAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'eas-simulator-2',
      env: expect.any(Object),
    });
    for (const [callIndex] of mockedUtils.startAsync.mock.calls.entries()) {
      const enableCallOrder =
        mockedUtils.enableAccessibilitySettingsAsync.mock.invocationCallOrder[callIndex];
      const startCallOrder = mockedUtils.startAsync.mock.invocationCallOrder[callIndex];
      expect(enableCallOrder).toBeLessThan(startCallOrder);
    }
  });

  it('disables apsd on the main device and every clone', async () => {
    mockedUtils.startAsync
      .mockResolvedValueOnce({ udid: 'base' as any })
      .mockResolvedValueOnce({ udid: 'clone-1' as any })
      .mockResolvedValueOnce({ udid: 'clone-2' as any });

    await createStep({ device_identifier: 'iPhone 15', count: 2 }).executeAsync();

    expect(mockedUtils.disableApsdAsync).toHaveBeenCalledWith({
      udid: 'base',
      env: expect.any(Object),
    });
    expect(mockedUtils.disableApsdAsync).toHaveBeenCalledWith({
      udid: 'clone-1',
      env: expect.any(Object),
    });
    expect(mockedUtils.disableApsdAsync).toHaveBeenCalledWith({
      udid: 'clone-2',
      env: expect.any(Object),
    });
  });

  it('configures the local egress proxy environment once each device is ready', async () => {
    mockedUtils.startAsync
      .mockResolvedValueOnce({ udid: 'base' as any })
      .mockResolvedValueOnce({ udid: 'clone-1' as any })
      .mockResolvedValueOnce({ udid: 'clone-2' as any });

    await createStep({ device_identifier: 'iPhone 15', count: 2 }).executeAsync();

    expect(mockedConfigureProxyEnvironment.mock.calls.map(([{ udid }]) => udid)).toEqual([
      'base',
      'clone-1',
      'clone-2',
    ]);
    for (const [callIndex] of mockedConfigureProxyEnvironment.mock.calls.entries()) {
      const readyCallOrder = mockedUtils.waitForReadyAsync.mock.invocationCallOrder[callIndex];
      const configureCallOrder =
        mockedConfigureProxyEnvironment.mock.invocationCallOrder[callIndex];
      expect(configureCallOrder).toBeGreaterThan(readyCallOrder);
    }
  });

  it('continues when disabling apsd fails', async () => {
    mockedUtils.disableApsdAsync.mockRejectedValue(new Error('apsd disable failed'));

    await createStep({ device_identifier: 'iPhone 15', count: 2 }).executeAsync();

    // Startup is not aborted: readiness is still awaited for each device.
    expect(mockedUtils.waitForReadyAsync).toHaveBeenCalled();
  });
});
