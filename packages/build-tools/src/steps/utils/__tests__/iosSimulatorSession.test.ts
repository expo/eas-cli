import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { IosSimulatorUtils, type IosSimulatorUuid } from '../../../utils/IosSimulatorUtils';
import { resolveIosSessionStartupAsync } from '../iosSimulatorSession';
import { readIosApplicationIdentifierAsync } from '../iosAppArtifact';
import {
  resolveLocalEgressServeSimBootEnvironmentAsync,
  startLocalEgressGuardRelayAsync,
} from '../localEgressGuard';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../../utils/IosSimulatorUtils');
jest.mock('../iosAppArtifact', () => ({ readIosApplicationIdentifierAsync: jest.fn() }));
jest.mock('../localEgressGuard', () => ({
  resolveLocalEgressServeSimBootEnvironmentAsync: jest.fn(),
  startLocalEgressGuardRelayAsync: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);
const mockedUtils = jest.mocked(IosSimulatorUtils);

describe('serve-sim Simulator preparation', () => {
  const hostOptions = {
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env: {},
    logger: createMockLogger(),
  };
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUtils.getAvailableDevicesAsync.mockResolvedValue([
      {
        udid: 'selected-udid',
        name: 'iPhone 17',
        isAvailable: true,
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
      },
    ] as never);
    mockedUtils.resolveUdidAsync.mockResolvedValue('selected-udid' as IosSimulatorUuid);
    jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue(null);
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as never);
    jest.mocked(readIosApplicationIdentifierAsync).mockResolvedValue('dev.example.app');
  });
  it.each([
    ['argument count', Array(257).fill('a')],
    ['argument length', ['a'.repeat(9000)]],
    ['NUL argument', ['a\u0000b']],
    ['total UTF-8 bytes', Array(8).fill('😃'.repeat(4096))],
  ])('rejects invalid launch %s before Simulator preparation', async (_, launchArgs) => {
    await expect(
      resolveIosSessionStartupAsync({
        ...hostOptions,
        bootSimulator: true,
        launchAppIdentifier: 'dev.example.app',
        launchArgs,
      })
    ).rejects.toThrow('iOS launch_args');
    expect(mockedUtils.getAvailableDevicesAsync).not.toHaveBeenCalled();
    expect(mockedUtils.resolveUdidAsync).not.toHaveBeenCalled();
    expect(resolveLocalEgressServeSimBootEnvironmentAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['an oversized URL', `https://example.test/${'a'.repeat(8192)}`],
    ['NUL in a URL', 'exp://example.test/a\0b'],
  ])('rejects %s before Simulator preparation', async (_, openUrl) => {
    await expect(
      resolveIosSessionStartupAsync({
        ...hostOptions,
        bootSimulator: true,
        launchAppIdentifier: 'dev.example.app',
        openUrl,
      })
    ).rejects.toThrow('iOS open_url');
    expect(mockedUtils.getAvailableDevicesAsync).not.toHaveBeenCalled();
    expect(mockedUtils.resolveUdidAsync).not.toHaveBeenCalled();
    expect(resolveLocalEgressServeSimBootEnvironmentAsync).not.toHaveBeenCalled();
  });

  it('keeps an explicit launch identifier independent of the installed app', async () => {
    const startup = await resolveIosSessionStartupAsync({
      ...hostOptions,
      installAppPath: '/tmp/App.app',
      launchAppIdentifier: 'another.installed.app',
    });
    expect(startup.launch.launchAppIdentifier).toBe('another.installed.app');
    expect(readIosApplicationIdentifierAsync).not.toHaveBeenCalled();
  });

  it('infers the launch identifier from the downloaded app', async () => {
    const startup = await resolveIosSessionStartupAsync({
      ...hostOptions,
      installAppPath: '/tmp/App.app',
    });
    expect(startup.launch.launchAppIdentifier).toBe('dev.example.app');
    expect(readIosApplicationIdentifierAsync).toHaveBeenCalledWith({
      artifactPath: '/tmp/App.app',
      env: {},
    });
  });

  it('does no Simulator work on Android and rejects iOS installation inputs', async () => {
    const options = { ...hostOptions, runtimePlatform: BuildRuntimePlatform.LINUX };
    await expect(resolveIosSessionStartupAsync(options)).resolves.toEqual({
      launch: { launchArgs: [], launchAppIdentifier: undefined, openUrl: undefined },
    });
    await expect(
      resolveIosSessionStartupAsync({ ...options, installAppPath: '/tmp/App.app' })
    ).rejects.toThrow('only supported for iOS');
    expect(mockedUtils.resolveUdidAsync).not.toHaveBeenCalled();
  });

  it('preserves older workflows that already prepared the Simulator and app', async () => {
    const startup = await resolveIosSessionStartupAsync({
      ...hostOptions,
      launchAppIdentifier: 'previously.installed.app',
    });
    expect(startup.iosStartup).toBeUndefined();
    expect(startup.launch.launchAppIdentifier).toBe('previously.installed.app');
    expect(mockedUtils.resolveUdidAsync).not.toHaveBeenCalled();
    expect(resolveLocalEgressServeSimBootEnvironmentAsync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('prepares a session without an app when the workflow requests owned startup', async () => {
    const startup = await resolveIosSessionStartupAsync({ ...hostOptions, bootSimulator: true });
    expect(startup.iosStartup?.iosSimulatorUdid).toBe('SELECTED-UDID');
    expect(startup.launch.launchAppIdentifier).toBeUndefined();
  });

  it.each(['Booted', 'Booting', 'Shutdown'])(
    'prepares guarded startup on a %s device',
    async state => {
      const bootEnv = { SERVE_SIM_ADDITIONAL_DYLIBS: '/guard.dylib' };
      jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue(bootEnv);
      mockedUtils.getDeviceAsync.mockResolvedValue({ state } as never);
      const startup = await resolveIosSessionStartupAsync({ ...hostOptions, bootSimulator: true });
      expect(startup.iosStartup).toEqual({
        iosSimulatorUdid: 'SELECTED-UDID',
        bootEnv,
        installAppPath: undefined,
      });
      if (state === 'Shutdown') {
        expect(spawn).not.toHaveBeenCalled();
      } else {
        expect(spawn).toHaveBeenCalledWith(
          'xcrun',
          ['simctl', 'shutdown', 'SELECTED-UDID'],
          expect.anything()
        );
      }
      expect(startLocalEgressGuardRelayAsync).toHaveBeenCalled();
      expect(mockedUtils.bootAsync).not.toHaveBeenCalled();
    }
  );

  it('resolves an explicit Simulator without booting or configuring it', async () => {
    const startup = await resolveIosSessionStartupAsync({
      ...hostOptions,
      deviceIdentifier: 'iPhone 17',
    });
    expect(startup.iosStartup?.iosSimulatorUdid).toBe('SELECTED-UDID');
    expect(mockedUtils.resolveUdidAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'iPhone 17',
      env: {},
    });
    expect(mockedUtils.getAvailableDevicesAsync).not.toHaveBeenCalled();
    expect(mockedUtils.bootAsync).not.toHaveBeenCalled();
    expect(mockedUtils.startAsync).not.toHaveBeenCalled();
    expect(mockedUtils.enableAccessibilitySettingsAsync).not.toHaveBeenCalled();
  });

  it('selects the default iPhone without booting', async () => {
    mockedUtils.getAvailableDevicesAsync.mockResolvedValue([
      { name: 'iPad', udid: 'ipad' },
      { name: 'iPhone 17 Pro', udid: 'pro' },
      { name: 'iPhone 17', udid: 'base' },
    ] as never);
    await resolveIosSessionStartupAsync({ ...hostOptions, bootSimulator: true });
    expect(mockedUtils.resolveUdidAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'base',
      env: {},
    });
    expect(mockedUtils.bootAsync).not.toHaveBeenCalled();
    mockedUtils.getAvailableDevicesAsync.mockResolvedValue([]);
    await expect(
      resolveIosSessionStartupAsync({ ...hostOptions, bootSimulator: true })
    ).rejects.toThrow('Could not find an iPhone');
  });
});
