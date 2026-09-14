import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { configureSimulatorProxyEnvironmentAsync } from '../../utils/localEgress';
import {
  installLocalEgressGuardAsync,
  resolveLocalEgressBootEnvironmentAsync,
  verifyLocalEgressGuardAsync,
} from '../../utils/localEgressGuard';
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
    resolveUdidAsync: jest.fn(),
    bootAsync: jest.fn(),
    startAsync: jest.fn(),
    waitForReadyAsync: jest.fn(),
    disableApsdAsync: jest.fn(),
  },
}));

jest.mock('../../utils/localEgress', () => ({
  configureSimulatorProxyEnvironmentAsync: jest.fn(),
}));
jest.mock('../../utils/localEgressGuard', () => ({
  installLocalEgressGuardAsync: jest.fn(),
  resolveLocalEgressBootEnvironmentAsync: jest.fn(),
  verifyLocalEgressGuardAsync: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);
const mockedUtils = jest.mocked(IosSimulatorUtils);
const mockedConfigureProxyEnvironment = jest.mocked(configureSimulatorProxyEnvironmentAsync);
const mockedInstallGuard = jest.mocked(installLocalEgressGuardAsync);
const mockedVerifyGuard = jest.mocked(verifyLocalEgressGuardAsync);
const mockedResolveBootEnvironment = jest.mocked(resolveLocalEgressBootEnvironmentAsync);

// Names resolve to udids the way the step expects; udids pass through.
const UDIDS: Record<string, string> = {
  'iPhone 15': 'base',
  'eas-simulator-1': 'clone-1',
  'eas-simulator-2': 'clone-2',
};

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
    mockedUtils.resolveUdidAsync.mockImplementation(
      async ({ deviceIdentifier }) => (UDIDS[deviceIdentifier] ?? deviceIdentifier) as any
    );
    mockedUtils.bootAsync.mockResolvedValue(undefined);
    mockedUtils.startAsync.mockImplementation(async ({ deviceIdentifier }) => ({
      udid: deviceIdentifier as any,
    }));
    mockedUtils.waitForReadyAsync.mockResolvedValue(undefined);
    mockedUtils.disableApsdAsync.mockResolvedValue(undefined);
    mockedConfigureProxyEnvironment.mockResolvedValue(false);
    mockedInstallGuard.mockResolvedValue(false);
    mockedVerifyGuard.mockResolvedValue(undefined);
    mockedResolveBootEnvironment.mockResolvedValue(null);
  });

  it('does not enable accessibility settings by default', async () => {
    await createStep({ device_identifier: 'iPhone 15' }).executeAsync();

    expect(mockedUtils.enableAccessibilitySettingsAsync).not.toHaveBeenCalled();
    expect(mockedUtils.resolveUdidAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'iPhone 15',
      env: expect.any(Object),
    });
    expect(mockedUtils.bootAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'base',
      env: expect.any(Object),
      launchdEnvironment: {},
    });
    expect(mockedUtils.startAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'base',
      env: expect.any(Object),
    });
  });

  it('enables accessibility settings before starting the main device and every clone when requested', async () => {
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

  it('installs the proxy environment and guard between boot and boot completion, then verifies the guard', async () => {
    mockedInstallGuard.mockResolvedValue(true);

    await createStep({ device_identifier: 'iPhone 15', count: 2 }).executeAsync();

    const udids = ['base', 'clone-1', 'clone-2'];
    expect(
      mockedUtils.bootAsync.mock.calls.map(([{ deviceIdentifier }]) => deviceIdentifier)
    ).toEqual(udids);
    expect(mockedConfigureProxyEnvironment.mock.calls.map(([{ udid }]) => udid)).toEqual(udids);
    expect(mockedInstallGuard.mock.calls.map(([{ udid }]) => udid)).toEqual(udids);
    expect(mockedVerifyGuard.mock.calls.map(([{ udid }]) => udid)).toEqual(udids);
    for (const [callIndex] of udids.entries()) {
      const bootOrder = mockedUtils.bootAsync.mock.invocationCallOrder[callIndex];
      const configureOrder = mockedConfigureProxyEnvironment.mock.invocationCallOrder[callIndex];
      const guardOrder = mockedInstallGuard.mock.invocationCallOrder[callIndex];
      const bootCompleteOrder = mockedUtils.startAsync.mock.invocationCallOrder[callIndex];
      const verifyOrder = mockedVerifyGuard.mock.invocationCallOrder[callIndex];
      const readyOrder = mockedUtils.waitForReadyAsync.mock.invocationCallOrder[callIndex];
      // launchd is up when boot returns and has spawned nothing yet: that is the
      // only moment at which its environment reaches every process of the boot.
      expect(guardOrder).toBeGreaterThan(bootOrder);
      expect(configureOrder).toBeGreaterThan(guardOrder);
      expect(configureOrder).toBeLessThan(bootCompleteOrder);
      // The self-check needs a completed boot and runs before anything else.
      expect(verifyOrder).toBeGreaterThan(bootCompleteOrder);
      expect(verifyOrder).toBeLessThan(readyOrder);
    }
  });

  it('boots with the local egress environment so the first processes inherit it', async () => {
    mockedResolveBootEnvironment.mockResolvedValue({
      DYLD_INSERT_LIBRARIES: '/w/bin/egress-guard.dylib',
      https_proxy: 'http://127.0.0.1:8899',
    });

    await createStep({ device_identifier: 'iPhone 15', count: 2 }).executeAsync();

    for (const [{ deviceIdentifier, launchdEnvironment }] of mockedUtils.bootAsync.mock.calls) {
      expect(['base', 'clone-1', 'clone-2']).toContain(deviceIdentifier);
      expect(launchdEnvironment).toEqual({
        DYLD_INSERT_LIBRARIES: '/w/bin/egress-guard.dylib',
        https_proxy: 'http://127.0.0.1:8899',
      });
    }
  });

  it('boots with an empty launchd environment when no local egress session is active', async () => {
    await createStep({ device_identifier: 'iPhone 15' }).executeAsync();

    expect(mockedUtils.bootAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'base',
      env: expect.any(Object),
      launchdEnvironment: {},
    });
  });

  it('skips the guard verification when no local egress session is active', async () => {
    mockedInstallGuard.mockResolvedValue(false);

    await createStep({ device_identifier: 'iPhone 15' }).executeAsync();

    expect(mockedVerifyGuard).not.toHaveBeenCalled();
  });

  it('fails the step when the guard cannot be installed or verified', async () => {
    mockedInstallGuard.mockRejectedValueOnce(new Error('guard library missing'));
    await expect(createStep({ device_identifier: 'iPhone 15' }).executeAsync()).rejects.toThrow(
      'guard library missing'
    );

    mockedInstallGuard.mockResolvedValue(true);
    mockedVerifyGuard.mockRejectedValueOnce(new Error('self-check failed'));
    await expect(createStep({ device_identifier: 'iPhone 15' }).executeAsync()).rejects.toThrow(
      'self-check failed'
    );
  });

  it('continues when disabling apsd fails', async () => {
    mockedUtils.disableApsdAsync.mockRejectedValue(new Error('apsd disable failed'));

    await createStep({ device_identifier: 'iPhone 15', count: 2 }).executeAsync();

    // Startup is not aborted: readiness is still awaited for each device.
    expect(mockedUtils.waitForReadyAsync).toHaveBeenCalled();
  });
});
