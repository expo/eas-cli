import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { type CustomBuildContext } from '../../../customBuildContext';
import { AndroidEmulatorUtils } from '../../../utils/AndroidEmulatorUtils';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { sleepAsync } from '../../../utils/retry';
import { turtleFetch } from '../../../utils/turtleFetch';
import { startAppiumEventCollectionAsync } from '../../utils/appiumEvents';
import { startDeviceSessionHostAsync } from '../../utils/deviceSessionHost';
import {
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
} from '../../utils/remoteDeviceRunSession';

import {
  createStartAppiumRemoteSessionBuildFunction,
  installAppiumAsync,
  resolveAppium3VersionSpec,
  resolveAppiumDeviceAsync,
} from '../startAppiumRemoteSession';

jest.mock('../../../utils/AndroidEmulatorUtils', () => ({
  AndroidEmulatorUtils: { getAttachedDevicesAsync: jest.fn() },
}));
jest.mock('../../../utils/IosSimulatorUtils', () => ({
  IosSimulatorUtils: {
    getAvailableDevicesAsync: jest.fn(),
    resolveUdidAsync: jest.fn().mockResolvedValue('chosen-ios-udid'),
  },
}));
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  spawnDetached: jest.fn(),
  startNgrokTunnelAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
}));
jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../../sentry');
jest.mock('../../../utils/retry', () => ({
  ...jest.requireActual('../../../utils/retry'),
  sleepAsync: jest.fn(),
}));
jest.mock('../../../utils/turtleFetch', () => ({
  ...jest.requireActual('../../../utils/turtleFetch'),
  turtleFetch: jest.fn(),
}));
jest.mock('../../utils/appiumEvents', () => ({ startAppiumEventCollectionAsync: jest.fn() }));
jest.mock('../../utils/deviceSessionHost');
jest.mock('../../utils/iosAppArtifact', () => ({
  ...jest.requireActual('../../utils/iosAppArtifact'),
  readIosApplicationIdentifierAsync: jest.fn().mockResolvedValue('dev.example.app'),
}));
jest.mock('../../utils/localEgressGuard', () => ({
  resolveLocalEgressServeSimBootEnvironmentAsync: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../utils/localEgressSession', () => ({
  ...jest.requireActual('../../utils/localEgressSession'),
  uploadRemoteSessionConfigWithLocalEgressAsync: jest.fn(),
}));

const logger = { info: jest.fn(), warn: jest.fn() } as never;

describe(resolveAppium3VersionSpec, () => {
  it('uses the worker-supported Appium 3 version by default', () => {
    expect(resolveAppium3VersionSpec(undefined)).toBe('^3');
  });

  it.each(['3', '^3', '3.x', '3.5.0', '>=3 <4'])('accepts Appium 3 version %s', version => {
    expect(resolveAppium3VersionSpec(version)).toBe(version);
  });

  it.each(['2', '2.19.0', 'latest', '4.0.0', '>=3'])('rejects version %s', version => {
    expect(() => resolveAppium3VersionSpec(version)).toThrow(
      `Appium 3 is required for EAS Simulator sessions. Received package version "${version}".`
    );
  });
});

describe(resolveAppiumDeviceAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns XCUITest capabilities for the booted iOS simulator', async () => {
    jest
      .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
      .mockResolvedValue([{ udid: 'ios-simulator-id' } as never]);

    await expect(
      resolveAppiumDeviceAsync({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: {},
      })
    ).resolves.toEqual({
      platformName: 'iOS',
      automationName: 'XCUITest',
      driverName: 'xcuitest',
      udid: 'ios-simulator-id',
    });
    expect(IosSimulatorUtils.getAvailableDevicesAsync).toHaveBeenCalledWith({
      env: {},
      filter: 'booted',
    });
  });

  it('returns UiAutomator2 capabilities for the booted Android emulator', async () => {
    jest
      .mocked(AndroidEmulatorUtils.getAttachedDevicesAsync)
      .mockResolvedValue([{ serialId: 'emulator-5554', state: 'device' } as never]);

    await expect(
      resolveAppiumDeviceAsync({
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
      })
    ).resolves.toEqual({
      platformName: 'Android',
      automationName: 'UiAutomator2',
      driverName: 'uiautomator2',
      udid: 'emulator-5554',
    });
    expect(AndroidEmulatorUtils.getAttachedDevicesAsync).toHaveBeenCalledWith({ env: {} });
    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();
  });
});

describe(installAppiumAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(spawn).mockImplementation((async (_command: string, args: string[]) => {
      if (args.includes('--json')) {
        return { stdout: JSON.stringify({}) };
      }
      return { stdout: '' };
    }) as never);
  });

  it('installs Appium with npm by default', async () => {
    const result = await installAppiumAsync({
      versionSpec: '^3',
      driverName: 'xcuitest',
      env: { EXISTING: 'value' },
      logger,
    });

    try {
      expect(spawn).toHaveBeenNthCalledWith(
        1,
        'npm',
        ['install', '--no-audit', 'appium@^3'],
        expect.objectContaining({
          cwd: result.appiumHome,
          env: expect.objectContaining({ APPIUM_HOME: result.appiumHome, EXISTING: 'value' }),
        })
      );
      expect(spawn).toHaveBeenCalledWith(
        result.appiumBinPath,
        ['driver', 'install', 'xcuitest'],
        expect.objectContaining({ env: result.appiumEnv, logger })
      );
    } finally {
      await fs.promises.rm(result.appiumHome, { recursive: true, force: true });
    }
  });

  it('installs Appium with bun add when EAS_OVERRIDE_PACKAGE_MANAGER is bun', async () => {
    const result = await installAppiumAsync({
      versionSpec: '3.5.0',
      driverName: 'uiautomator2',
      env: { EAS_OVERRIDE_PACKAGE_MANAGER: 'bun' },
      logger,
    });

    try {
      expect(spawn).toHaveBeenNthCalledWith(
        1,
        'bun',
        ['add', 'appium@3.5.0'],
        expect.objectContaining({ cwd: result.appiumHome })
      );
    } finally {
      await fs.promises.rm(result.appiumHome, { recursive: true, force: true });
    }
  });
});

describe('createStartAppiumRemoteSessionBuildFunction', () => {
  it('declares the launch inputs so serve-sim can launch the app', () => {
    const ctx = {} as unknown as CustomBuildContext;
    const buildFunction = createStartAppiumRemoteSessionBuildFunction(ctx);
    const globalCtx = createGlobalContextMock();

    expect(
      buildFunction.inputProviders?.map(provider => provider(globalCtx, 'Test step').id)
    ).toEqual(expect.arrayContaining(['launch_app_identifier', 'launch_args', 'open_url']));
  });
});

describe('createStartAppiumRemoteSessionBuildFunction session lifecycle', () => {
  const stopError = new Error('Process output drain timed out after 5000ms.');
  const stopAppium = jest.fn();
  const stopEventCollection = jest.fn();

  beforeEach(() => {
    jest.mocked(spawn).mockImplementation((async (_command: string, args: string[]) => ({
      stdout: args.includes('--json') ? '{}' : '',
    })) as never);
    jest
      .mocked(AndroidEmulatorUtils.getAttachedDevicesAsync)
      .mockResolvedValue([{ serialId: 'emulator-5554', state: 'device' } as never]);
    stopAppium.mockRejectedValue(stopError);
    jest.mocked(spawnDetached).mockReturnValue({
      pid: 4242,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopAppium,
    });
    jest.mocked(turtleFetch).mockResolvedValue({ ok: true } as never);
    stopEventCollection.mockResolvedValue(undefined);
    jest.mocked(startAppiumEventCollectionAsync).mockResolvedValue({
      stopAsync: stopEventCollection,
      getLastEventObservedAt: () => undefined,
    });
    jest.mocked(startNgrokTunnelAsync).mockResolvedValue({
      url: 'https://appium-abc.tunnel.example.com',
      subdomainId: 'appium-abc',
      stopAsync: jest.fn(),
    });
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValue({
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.tunnel.example.com',
        closeAsync: jest.fn(),
      }),
      finishAsync: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runSessionAsync(
    logger: { info: jest.Mock; warn: jest.Mock },
    runtimePlatform = BuildRuntimePlatform.LINUX
  ): Promise<void> {
    await createStartAppiumRemoteSessionBuildFunction({} as CustomBuildContext).fn!(
      {
        logger,
        global: { runtimePlatform },
      } as unknown as BuildStepContext,
      {
        inputs: {
          package_version: { value: undefined },
          max_idle_time_minutes: { value: undefined },
        },
        outputs: {},
        env: {
          DEVICE_RUN_SESSION_ID: 'device-run-session-id',
          EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN: 'tunnel.example.com',
          NGROK_AUTHTOKEN: 'ngrok-token',
        },
      } as never
    );
  }

  function expectAppiumStoppedAndHomeRemoved(logger: { warn: jest.Mock }): void {
    expect(stopAppium).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(jest.mocked(spawnDetached).mock.calls[0][0].env.APPIUM_HOME!)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: stopError },
      'Could not stop the Appium server during remote session teardown.'
    );
  }

  it('selects Xcode only once for an already-prepared iOS session', async () => {
    stopAppium.mockResolvedValue(undefined);
    jest.mocked(selectXcodeDeveloperDirectoryAsync).mockClear();
    jest
      .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
      .mockResolvedValue([{ udid: 'chosen-ios-udid' } as never]);
    await runSessionAsync({ info: jest.fn(), warn: jest.fn() }, BuildRuntimePlatform.DARWIN);
    expect(selectXcodeDeveloperDirectoryAsync).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(selectXcodeDeveloperDirectoryAsync).mock.invocationCallOrder[0]
    ).toBeLessThan(
      jest.mocked(IosSimulatorUtils.getAvailableDevicesAsync).mock.invocationCallOrder[0]
    );
  });

  it('starts serve-sim on the selected iOS device while Appium installation is pending', async () => {
    stopAppium.mockResolvedValue(undefined);
    jest.mocked(selectXcodeDeveloperDirectoryAsync).mockClear();
    jest.mocked(IosSimulatorUtils.getAvailableDevicesAsync).mockClear();
    let releaseInstall!: (value: unknown) => void;
    let enteredInstall!: () => void;
    const installEntered = new Promise<void>(resolve => {
      enteredInstall = resolve;
    });
    jest.mocked(spawn).mockImplementationOnce(() => {
      enteredInstall();
      return new Promise(resolve => {
        releaseInstall = resolve;
      }) as never;
    });
    const running = createStartAppiumRemoteSessionBuildFunction({} as CustomBuildContext).fn!(
      {
        logger: { info: jest.fn(), warn: jest.fn() },
        global: { runtimePlatform: BuildRuntimePlatform.DARWIN },
      } as unknown as BuildStepContext,
      {
        inputs: {
          package_version: { value: undefined },
          max_idle_time_minutes: { value: undefined },
          device_identifier: { value: 'chosen-device' },
          install_app_path: { value: '/tmp/App.app' },
          launch_args: { value: ['--literal'] },
          open_url: { value: 'example://home' },
        },
        outputs: {},
        env: {
          DEVICE_RUN_SESSION_ID: 'device-run-session-id',
          EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN: 'tunnel.example.com',
          NGROK_AUTHTOKEN: 'ngrok-token',
        },
      } as never
    );
    await installEntered;
    expect(
      jest.mocked(selectXcodeDeveloperDirectoryAsync).mock.invocationCallOrder[0]
    ).toBeLessThan(jest.mocked(IosSimulatorUtils.resolveUdidAsync).mock.invocationCallOrder[0]);
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        iosSimulatorUdid: 'CHOSEN-IOS-UDID',
        installAppPath: '/tmp/App.app',
        launchAppIdentifier: 'dev.example.app',
        launchArgs: ['--literal'],
        openUrl: 'example://home',
      })
    );
    expect(IosSimulatorUtils.getAvailableDevicesAsync).not.toHaveBeenCalled();
    releaseInstall({ stdout: '' });
    await running;
    expect(selectXcodeDeveloperDirectoryAsync).toHaveBeenCalledTimes(1);
    expect(stopAppium).toHaveBeenCalledTimes(1);
  });

  it('keeps the readiness error when Appium cannot be stopped', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.mocked(sleepAsync).mockImplementation(async ms => {
      now += ms;
    });
    jest.mocked(turtleFetch).mockRejectedValue(new Error('connect ECONNREFUSED'));
    const logger = { info: jest.fn(), warn: jest.fn() };

    await expect(runSessionAsync(logger)).rejects.toThrow(
      'Timed out waiting for Appium to become ready.'
    );
    expectAppiumStoppedAndHomeRemoved(logger);
    expect(startAppiumEventCollectionAsync).not.toHaveBeenCalled();
    expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
  });

  it('keeps the event collection error when Appium cannot be stopped', async () => {
    const collectionError = new Error('event collection failed');
    jest.mocked(startAppiumEventCollectionAsync).mockRejectedValueOnce(collectionError);
    const logger = { info: jest.fn(), warn: jest.fn() };

    await expect(runSessionAsync(logger)).rejects.toBe(collectionError);
    expectAppiumStoppedAndHomeRemoved(logger);
    expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
  });

  it('fails a finished session when Appium cannot be stopped', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };

    await expect(runSessionAsync(logger)).rejects.toBe(stopError);
    expectAppiumStoppedAndHomeRemoved(logger);
    expect(stopEventCollection.mock.invocationCallOrder[0]).toBeLessThan(
      stopAppium.mock.invocationCallOrder[0]
    );
  });
});
