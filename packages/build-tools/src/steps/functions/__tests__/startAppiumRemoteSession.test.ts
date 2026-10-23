import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { type CustomBuildContext } from '../../../customBuildContext';
import { AndroidEmulatorUtils } from '../../../utils/AndroidEmulatorUtils';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import * as processes from '../../../utils/processes';
import { sleepAsync } from '../../../utils/retry';
import { turtleFetch } from '../../../utils/turtleFetch';
import { startAppiumEventCollectionAsync } from '../../utils/appiumEvents';
import { startDeviceSessionHostAsync } from '../../utils/deviceSessionHost';
import { preparePreinstalledWdaAsync } from '../../utils/preinstalledWda';
import {
  ensureFfmpegInstalledOnceAsync,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  waitForDeviceRunSessionStoppedAsync,
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
    getDeviceAsync: jest.fn(),
    resolveUdidAsync: jest.fn().mockResolvedValue('chosen-ios-udid'),
  },
}));
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  ensureFfmpegInstalledOnceAsync: jest.fn(),
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
jest.mock('../../utils/preinstalledWda', () => ({ preparePreinstalledWdaAsync: jest.fn() }));
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
    jest.mocked(IosSimulatorUtils.getAvailableDevicesAsync).mockResolvedValue([
      {
        udid: 'ios-simulator-id',
        runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
      } as never,
    ]);

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
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
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
    ).toEqual(
      expect.arrayContaining([
        'launch_app_identifier',
        'launch_args',
        'open_url',
        'public_preview',
        'private_preview_url',
      ])
    );
  });
});

describe('createStartAppiumRemoteSessionBuildFunction session lifecycle', () => {
  const stopError = new Error('Process output drain timed out after 5000ms.');
  const stopAppium = jest.fn();
  const stopEventCollection = jest.fn();

  beforeEach(() => {
    jest.mocked(ensureFfmpegInstalledOnceAsync).mockResolvedValue(undefined);
    jest.mocked(preparePreinstalledWdaAsync).mockResolvedValue({});
    jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({
      udid: 'CHOSEN-IOS-UDID',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
      state: 'Shutdown',
    } as never);
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
      getLastPreviewActivityAt: jest.fn(),
      finishAsync: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runSessionAsync(
    logger: { info: jest.Mock; warn: jest.Mock },
    maxIdleTimeMinutes?: number,
    runtimePlatform = BuildRuntimePlatform.LINUX,
    startupInputs: Record<string, { value: unknown }> = {}
  ): Promise<void> {
    await createStartAppiumRemoteSessionBuildFunction({} as CustomBuildContext).fn!(
      {
        logger,
        global: { runtimePlatform },
      } as unknown as BuildStepContext,
      {
        inputs: {
          package_version: { value: undefined },
          max_idle_time_minutes: { value: maxIdleTimeMinutes },
          ...startupInputs,
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

  it.each([false, true])(
    'preserves preview settings with Simulator startup %s',
    async bootSimulator => {
      stopAppium.mockResolvedValue(undefined);
      jest
        .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
        .mockResolvedValue([{ udid: 'chosen-ios-udid' } as never]);
      await runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {
        ...(bootSimulator
          ? { boot_simulator: { value: true }, device_identifier: { value: 'chosen-device' } }
          : {}),
        public_preview: { value: false },
        private_preview_url: { value: 'https://expo.dev/private-preview' },
        frame_ancestors: { value: ['https://preview.example.com'] },
        cors_origins: { value: ['https://api.example.com'] },
      });
      expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          disableShare: true,
          privatePreviewUrl: 'https://expo.dev/private-preview',
          frameAncestors: ['https://preview.example.com'],
          corsOrigins: ['https://api.example.com'],
        })
      );
    }
  );

  it('selects Xcode only once for an already-prepared iOS session', async () => {
    stopAppium.mockResolvedValue(undefined);
    jest.mocked(selectXcodeDeveloperDirectoryAsync).mockClear();
    jest.mocked(IosSimulatorUtils.getAvailableDevicesAsync).mockResolvedValue([
      {
        udid: 'chosen-ios-udid',
        runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4',
      } as never,
    ]);
    jest.mocked(preparePreinstalledWdaAsync).mockResolvedValue({
      'appium:usePreinstalledWDA': true,
      'appium:prebuiltWDAPath': '/tmp/legacy-wda.app',
    });
    await runSessionAsync(
      { info: jest.fn(), warn: jest.fn() },
      undefined,
      BuildRuntimePlatform.DARWIN
    );
    expect(preparePreinstalledWdaAsync).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4' })
    );
    expect(IosSimulatorUtils.getDeviceAsync).not.toHaveBeenCalled();
    expect(JSON.parse(jest.mocked(spawnDetached).mock.calls[0][0].args.at(-1)!)).toEqual({
      'appium:eventTimings': true,
      'appium:isHeadless': true,
      'appium:usePreinstalledWDA': true,
      'appium:prebuiltWDAPath': '/tmp/legacy-wda.app',
    });
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
    jest.mocked(preparePreinstalledWdaAsync).mockResolvedValue({
      'appium:usePreinstalledWDA': true,
      'appium:prebuiltWDAPath': '/tmp/selected-wda.app',
    });
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
    expect(preparePreinstalledWdaAsync).not.toHaveBeenCalled();
    const readyHost = await jest.mocked(startDeviceSessionHostAsync).mock.results[0].value;
    expect(readyHost.finishAsync).not.toHaveBeenCalled();
    expect(jest.mocked(startDeviceSessionHostAsync).mock.calls[0][1].signal?.aborted).toBe(false);
    releaseInstall({ stdout: '' });
    await running;
    expect(readyHost.finishAsync).toHaveBeenCalledTimes(1);
    expect(IosSimulatorUtils.getDeviceAsync).toHaveBeenCalledWith({
      udid: 'CHOSEN-IOS-UDID',
      env: expect.objectContaining({ DEVICE_RUN_SESSION_ID: 'device-run-session-id' }),
    });
    expect(preparePreinstalledWdaAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
        appiumHome: jest.mocked(spawnDetached).mock.calls[0][0].env.APPIUM_HOME,
      })
    );
    expect(JSON.parse(jest.mocked(spawnDetached).mock.calls[0][0].args.at(-1)!)).toEqual({
      'appium:eventTimings': true,
      'appium:isHeadless': true,
      'appium:usePreinstalledWDA': true,
      'appium:prebuiltWDAPath': '/tmp/selected-wda.app',
    });
    expect(selectXcodeDeveloperDirectoryAsync).toHaveBeenCalledTimes(1);
    expect(stopAppium).toHaveBeenCalledTimes(1);
  });

  it('drains a failed Simulator startup installer before removing its Appium home', async () => {
    const hostError = new Error('Simulator boot failed');
    let failHost!: (error: Error) => void;
    jest.mocked(startDeviceSessionHostAsync).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failHost = reject;
      })
    );
    let enteredInstall!: () => void;
    const installEntered = new Promise<void>(resolve => {
      enteredInstall = resolve;
    });
    let closeInstaller!: (error: Error) => void;
    const child = { pid: 12345, kill: jest.fn() };
    jest.mocked(spawn).mockImplementationOnce(() => {
      enteredInstall();
      return Object.assign(
        new Promise((_resolve, reject) => {
          closeInstaller = reject;
        }),
        { child }
      ) as never;
    });
    const killGroup = jest.spyOn(processes, 'killProcessGroup').mockImplementation(() => {});
    const running = runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {
      boot_simulator: { value: true },
      device_identifier: { value: 'chosen-device' },
    });
    const settled = jest.fn();
    const observed = running.then(settled, settled);
    try {
      await installEntered;
      const home = jest.mocked(spawn).mock.calls[0][2]?.cwd as string;
      const hostOptions = jest.mocked(startDeviceSessionHostAsync).mock.calls[0][1];
      hostOptions.onStartupError?.(hostError);
      failHost(hostError);
      await Promise.resolve();
      expect(killGroup).toHaveBeenCalledWith(child, 'SIGKILL');
      expect(settled).not.toHaveBeenCalled();
      expect(fs.existsSync(home)).toBe(true);
      closeInstaller(new Error('installer interrupted'));
      await expect(running).rejects.toBe(hostError);
      expect(fs.existsSync(home)).toBe(false);
      expect(preparePreinstalledWdaAsync).not.toHaveBeenCalled();
      expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
    } finally {
      closeInstaller?.(new Error('test cleanup'));
      await observed;
    }
  });

  it('removes a completed Appium install when Simulator failure interrupts FFmpeg setup', async () => {
    const hostError = new Error('Simulator startup failed');
    let failHost!: (error: Error) => void;
    jest.mocked(startDeviceSessionHostAsync).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failHost = reject;
      })
    );
    jest
      .mocked(ensureFfmpegInstalledOnceAsync)
      .mockImplementationOnce(
        ({ signal }) =>
          new Promise(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }))
      );
    let installed!: () => void;
    const installationFinished = new Promise<void>(resolve => {
      installed = resolve;
    });
    jest.mocked(spawn).mockImplementation((async (_command: string, args: string[]) => {
      if (args[0] === 'driver' && args[1] === 'install') {
        installed();
      }
      return { stdout: args.includes('--json') ? '{}' : '' };
    }) as never);
    const running = runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {
      boot_simulator: { value: true },
      device_identifier: { value: 'chosen-device' },
    });
    await installationFinished;
    await new Promise<void>(resolve => setImmediate(resolve));
    jest.mocked(startDeviceSessionHostAsync).mock.calls[0][1].onStartupError?.(hostError);
    failHost(hostError);
    await expect(running).rejects.toBe(hostError);
    const home = jest.mocked(spawn).mock.calls[0][2]?.cwd as string;
    expect(fs.existsSync(home)).toBe(false);
    expect(preparePreinstalledWdaAsync).not.toHaveBeenCalled();
  });

  it('preserves an installer failure before a later host failure during home cleanup', async () => {
    const installError = new Error('npm install failed');
    const hostError = new Error('later Simulator failure');
    let failHost!: (error: Error) => void;
    jest.mocked(startDeviceSessionHostAsync).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        failHost = reject;
      })
    );
    jest.mocked(spawn).mockRejectedValueOnce(installError);
    const remove = fs.promises.rm.bind(fs.promises);
    let enteredCleanup!: () => void;
    const cleanupEntered = new Promise<void>(resolve => {
      enteredCleanup = resolve;
    });
    let releaseCleanup!: () => void;
    const cleanupGate = new Promise<void>(resolve => {
      releaseCleanup = resolve;
    });
    jest.spyOn(fs.promises, 'rm').mockImplementationOnce(async (directory, options) => {
      enteredCleanup();
      await cleanupGate;
      await remove(directory, options);
    });
    const running = runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {
      boot_simulator: { value: true },
      device_identifier: { value: 'chosen-device' },
    });
    const observed = running.catch(() => {});
    try {
      await cleanupEntered;
      const options = jest.mocked(startDeviceSessionHostAsync).mock.calls[0][1];
      expect(options.signal?.reason).toBe(installError);
      options.onStartupError?.(hostError);
      failHost(hostError);
      releaseCleanup();
      await expect(running).rejects.toBe(installError);
      expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
    } finally {
      failHost(hostError);
      releaseCleanup();
      await observed;
    }
  });

  it.each(['WDA download', 'Appium readiness'])(
    'keeps the Simulator error when it interrupts %s',
    async stage => {
      stopAppium.mockResolvedValue(undefined);
      const hostError = new Error('Simulator launch failed');
      const laterError = new Error(`${stage} interrupted`);
      let failHost!: (error: Error) => void;
      jest.mocked(startDeviceSessionHostAsync).mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          failHost = reject;
        })
      );
      let enteredStage!: () => void;
      const stageEntered = new Promise<void>(resolve => {
        enteredStage = resolve;
      });
      let rejectStage!: (error: Error) => void;
      let setupSignal: AbortSignal | undefined;
      const waitForStage = (signal?: AbortSignal): Promise<never> => {
        setupSignal = signal;
        enteredStage();
        return new Promise((_resolve, reject) => {
          rejectStage = reject;
          signal?.addEventListener('abort', () => reject(laterError), { once: true });
        });
      };
      if (stage === 'WDA download') {
        jest
          .mocked(preparePreinstalledWdaAsync)
          .mockImplementationOnce(({ signal }) => waitForStage(signal));
      } else {
        jest
          .mocked(turtleFetch)
          .mockImplementationOnce((_url, _method, options) =>
            waitForStage(options?.signal ?? undefined)
          );
      }
      const running = runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {
        boot_simulator: { value: true },
        device_identifier: { value: 'chosen-device' },
      });
      const observed = running.catch(() => {});
      try {
        await stageEntered;
        jest.mocked(startDeviceSessionHostAsync).mock.calls[0][1].onStartupError?.(hostError);
        failHost(hostError);
        await Promise.resolve();
        expect(setupSignal?.aborted).toBe(true);
        await expect(running).rejects.toBe(hostError);
        const home = jest.mocked(spawn).mock.calls[0][2]?.cwd as string;
        expect(fs.existsSync(home)).toBe(false);
        expect(startAppiumEventCollectionAsync).not.toHaveBeenCalled();
        expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
      } finally {
        rejectStage?.(laterError);
        await observed;
      }
    }
  );

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

  it('resets the idle timer on preview input from the session host', async () => {
    const previewInputAt = new Date('2026-10-19T12:00:00Z');
    const host = await jest.mocked(startDeviceSessionHostAsync).getMockImplementation()!(
      {} as never,
      {} as never
    );
    jest.mocked(host.getLastPreviewActivityAt).mockReturnValue(previewInputAt);

    await expect(runSessionAsync({ info: jest.fn(), warn: jest.fn() }, 5)).rejects.toBe(stopError);

    const { idleTimeout } = jest.mocked(waitForDeviceRunSessionStoppedAsync).mock.calls[0][0];
    expect(idleTimeout?.maxIdleTimeMinutes).toBe(5);
    expect(idleTimeout?.getLastPreviewActivityAt?.()).toBe(previewInputAt);
  });

  it('fails a finished session when Appium cannot be stopped', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };

    await expect(runSessionAsync(logger)).rejects.toBe(stopError);
    expect(preparePreinstalledWdaAsync).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeIdentifier: undefined })
    );
    expect(IosSimulatorUtils.getDeviceAsync).not.toHaveBeenCalled();
    expect(JSON.parse(jest.mocked(spawnDetached).mock.calls[0][0].args.at(-1)!)).toEqual({
      'appium:eventTimings': true,
    });
    expectAppiumStoppedAndHomeRemoved(logger);
    expect(stopEventCollection.mock.invocationCallOrder[0]).toBeLessThan(
      stopAppium.mock.invocationCallOrder[0]
    );
  });
});
