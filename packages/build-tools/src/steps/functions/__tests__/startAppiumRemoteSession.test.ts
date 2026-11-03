import { type WarmIosSession } from '../../utils/warmIosSession';
import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';
import * as timersPromises from 'node:timers/promises';

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
import { resolveLocalEgressServeSimBootEnvironmentAsync } from '../../utils/localEgressGuard';
import {
  WarmSessionAdoptionError,
  runOnWarmIosSimulatorAsync,
} from '../../utils/warmDeviceSessionHost';
import * as warmIosSession from '../../utils/warmIosSession';
import {
  ensureFfmpegInstalledOnceAsync,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../../utils/remoteDeviceRunSession';
import { watchDeviceRunSessionStartup } from '../../utils/deviceRunSessionStartup';
import { createStartupWatchMock } from '../../../__tests__/utils/startupWatch';

import {
  createStartAppiumRemoteSessionBuildFunction,
  installAppiumAsync,
  resolveAppium3VersionSpec,
  resolveAppiumDeviceAsync,
} from '../startAppiumRemoteSession';

jest.mock('node:timers/promises', () => ({
  ...jest.requireActual('node:timers/promises'),
  setTimeout: jest.fn(jest.requireActual('node:timers/promises').setTimeout),
}));
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
jest.mock('../../utils/deviceRunSessionStartup', () => ({
  watchDeviceRunSessionStartup: jest.fn(),
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
jest.mock('../../utils/warmDeviceSessionHost', () => ({
  ...jest.createMockFromModule<typeof import('../../utils/warmDeviceSessionHost')>(
    '../../utils/warmDeviceSessionHost'
  ),
  WarmSessionAdoptionError: jest.requireActual<typeof import('../../utils/warmDeviceSessionHost')>(
    '../../utils/warmDeviceSessionHost'
  ).WarmSessionAdoptionError,
}));
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
    jest.mocked(watchDeviceRunSessionStartup).mockImplementation(createStartupWatchMock);
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
    jest.mocked(watchDeviceRunSessionStartup).mockImplementation(createStartupWatchMock);
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
  it.each([
    [BuildRuntimePlatform.DARWIN, true],
    [BuildRuntimePlatform.DARWIN, false],
    [BuildRuntimePlatform.LINUX, true],
    [BuildRuntimePlatform.LINUX, false],
  ])('starts Appium on %s with helper present=%s', async (runtimePlatform, helperPresent) => {
    const helper = '/usr/local/libexec/turtle-tcc-fda';
    if (helperPresent) {
      fs.mkdirSync(path.dirname(helper), { recursive: true });
      fs.writeFileSync(helper, 'prepared helper');
    }
    jest.mocked(spawn).mockResolvedValue({ stdout: '{}' } as never);
    jest
      .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
      .mockResolvedValue([{ udid: 'simulator' }] as never);
    jest
      .mocked(AndroidEmulatorUtils.getAttachedDevicesAsync)
      .mockResolvedValue([{ serialId: 'emulator-5554', state: 'device' }] as never);
    // Stop at the launch boundary; no readiness requests or remote session are needed.
    const launched = new Error('launch captured');
    jest.mocked(spawnDetached).mockImplementation(() => {
      throw launched;
    });
    const env = {
      DEVICE_RUN_SESSION_ID: 'session',
      EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN: 'example.test',
      PATH: '/configured/node/bin:/usr/bin',
      DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
    };
    const buildFunction = createStartAppiumRemoteSessionBuildFunction({} as CustomBuildContext);
    await expect(
      buildFunction.fn!(
        { logger, global: { runtimePlatform } } as unknown as BuildStepContext,
        {
          inputs: {
            package_version: { value: undefined },
            max_idle_time_minutes: { value: undefined },
          },
          outputs: {},
          env: { ...env, NGROK_AUTHTOKEN: 'token' },
        } as never
      )
    ).rejects.toBe(launched);

    expect(spawnDetached).toHaveBeenCalledTimes(1);
    const launch = jest.mocked(spawnDetached).mock.calls[0][0];
    const appiumBinPath = path.join(launch.env.APPIUM_HOME!, 'node_modules', '.bin', 'appium');
    const useHelper = runtimePlatform === BuildRuntimePlatform.DARWIN && helperPresent;
    expect(launch).toEqual({
      command: useHelper ? helper : appiumBinPath,
      args: [
        ...(useHelper ? [appiumBinPath] : []),
        '--address',
        '127.0.0.1',
        '--port',
        '4723',
        '--base-path',
        '/',
        '--log-level',
        'error',
        '--allow-insecure',
        '*:session_discovery',
        '--default-capabilities',
        runtimePlatform === BuildRuntimePlatform.DARWIN
          ? '{"appium:eventTimings":true,"appium:isHeadless":true}'
          : '{"appium:eventTimings":true}',
      ],
      env: { ...env, APPIUM_HOME: launch.env.APPIUM_HOME },
      logger,
    });
  });

  it('claims the warm Simulator for Appium without its package version', async () => {
    jest.mocked(runOnWarmIosSimulatorAsync).mockResolvedValue(undefined);
    const buildFunction = createStartAppiumRemoteSessionBuildFunction({} as CustomBuildContext, {
      warm: true,
    });
    expect(buildFunction.id).toBe('start_warm_appium_remote_session');
    await buildFunction.fn!(
      {
        logger: { info: jest.fn(), warn: jest.fn() },
        global: { runtimePlatform: BuildRuntimePlatform.DARWIN },
      } as unknown as BuildStepContext,
      {
        inputs: {
          package_version: { value: '3.5.0' },
          max_idle_time_minutes: { value: undefined },
          device_identifier: { value: 'iPhone 17' },
        },
        outputs: {},
        env: {
          DEVICE_RUN_SESSION_ID: 'session',
          EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN: 'tunnel.example',
          NGROK_AUTHTOKEN: 'ngrok-token',
        },
      } as never
    );
    const [claim] = jest.mocked(runOnWarmIosSimulatorAsync).mock.calls[0];
    expect(claim).toMatchObject({ engine: 'appium', requestedDevice: 'iPhone 17' });
    expect(claim).not.toHaveProperty('packageVersion');
  });

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
  const finishHost = jest.fn();

  beforeEach(() => {
    jest
      .mocked(timersPromises.setTimeout)
      .mockImplementation(jest.requireActual('node:timers/promises').setTimeout);
    jest.mocked(watchDeviceRunSessionStartup).mockImplementation(createStartupWatchMock);
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
    finishHost.mockResolvedValue(undefined);
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValue({
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.tunnel.example.com',
        closeAsync: jest.fn(),
      }),
      getLastPreviewActivityAt: jest.fn(),
      finishAsync: finishHost,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runSessionAsync(
    logger: { info: jest.Mock; warn: jest.Mock },
    maxIdleTimeMinutes?: number,
    runtimePlatform = BuildRuntimePlatform.LINUX,
    startupInputs: Record<string, { value: unknown }> = {},
    warm = false
  ): Promise<void> {
    await createStartAppiumRemoteSessionBuildFunction({} as CustomBuildContext, { warm }).fn!(
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

  it('reports late host cleanup failure after startup Stop', async () => {
    stopAppium.mockResolvedValue(undefined);
    let entered!: () => void;
    const starting = new Promise<void>(resolve => {
      entered = resolve;
    });
    let failed!: AggregateError;
    jest.mocked(startDeviceSessionHostAsync).mockImplementationOnce(async (_ctx, options) => {
      entered();
      return await new Promise((_resolve, reject) => {
        options.signal!.addEventListener(
          'abort',
          () => {
            failed = new AggregateError([options.signal!.reason, new Error('host cleanup failed')]);
            setImmediate(() => reject(failed));
          },
          { once: true }
        );
      });
    });
    const running = runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {
      boot_simulator: { value: true },
      device_identifier: { value: 'selected-ios-udid' },
    });
    running.catch(() => {});
    await starting;
    jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value.stop();
    const failure = await running.then(
      () => undefined,
      error => error
    );
    expect(failure).toBe(failed);
    expect(waitForDeviceRunSessionStoppedAsync).not.toHaveBeenCalled();
  });

  it('keeps watching startup when warm adoption retries cold', async () => {
    stopAppium.mockResolvedValue(undefined);
    const adoption = new Error('warm adoption failed');
    jest.mocked(runOnWarmIosSimulatorAsync).mockImplementation(async (_claim, run) => {
      try {
        return await run({
          device: { udid: 'selected-ios-udid', name: 'iPhone 17' },
        } as WarmIosSession);
      } catch (error) {
        if (error !== adoption) {
          throw error;
        }
        return await run(undefined);
      }
    });
    jest.mocked(startDeviceSessionHostAsync).mockImplementationOnce(async (_ctx, options) => {
      options.onStartupError?.(adoption);
      throw adoption;
    });
    await expect(
      Promise.resolve(
        runSessionAsync(
          logger,
          undefined,
          BuildRuntimePlatform.DARWIN,
          { boot_simulator: { value: true }, device_identifier: { value: 'selected-ios-udid' } },
          true
        )
      )
    ).resolves.toBeUndefined();
    expect(watchDeviceRunSessionStartup).toHaveBeenCalledTimes(1);
    expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'observes Stop during warm claim and preserves cleanup failure=%s',
    async failCleanup => {
      let entered!: () => void;
      const claiming = new Promise<void>(resolve => {
        entered = resolve;
      });
      const cleanup = new Error('warm cleanup failed');
      jest.mocked(runOnWarmIosSimulatorAsync).mockImplementation(async claim => {
        entered();
        await new Promise<void>((_resolve, reject) => {
          claim.signal!.addEventListener(
            'abort',
            () =>
              reject(
                failCleanup
                  ? new AggregateError([claim.signal!.reason, cleanup])
                  : claim.signal!.reason
              ),
            { once: true }
          );
        });
      });
      const running = runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {}, true);
      running.catch(() => {});
      await claiming;
      jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value.stop();
      if (failCleanup) {
        await expect(running).rejects.toMatchObject({ errors: expect.arrayContaining([cleanup]) });
      } else {
        await expect(running).resolves.toBeUndefined();
      }
      expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
    }
  );
  it('passes the existing Android selection to the preview host', async () => {
    stopAppium.mockResolvedValue(undefined);
    await runSessionAsync(logger);
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ previewDeviceId: 'emulator-5554' })
    );
  });

  it('passes the selected iOS preview target without enabling Simulator startup', async () => {
    stopAppium.mockResolvedValue(undefined);
    const udid = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
    jest
      .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
      .mockResolvedValue([{ udid }, { udid: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB' }] as Awaited<
        ReturnType<typeof IosSimulatorUtils.getAvailableDevicesAsync>
      >);
    await runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN);
    const options = jest.mocked(startDeviceSessionHostAsync).mock.calls[0][1];
    expect(options).toHaveProperty('previewDeviceId', udid);
    expect(options.iosSimulatorUdid).toBeUndefined();
  });

  function mockWarmSession(): jest.Mock {
    const stopWarm = jest.fn().mockResolvedValue(undefined);
    const warm: warmIosSession.WarmIosSession = {
      device: { udid: 'CHOSEN-IOS-UDID', name: 'iPhone 17' },
      server: { pid: 100, port: 3200, token: 'warm-token' },
      agentDeviceStateDir: '/warm/agent-device',
      argentEventLogPath: '/warm/argent-events',
      prepareToolsAsync: jest.fn(),
      process: {
        pid: 100,
        getOutput: () => '',
        getExitError: () => undefined,
        stopAsync: stopWarm,
      },
    };
    jest.spyOn(warmIosSession, 'tryClaimWarmIosSessionAsync').mockResolvedValue(warm);
    jest
      .mocked(runOnWarmIosSimulatorAsync)
      .mockImplementation(
        jest.requireActual<typeof import('../../utils/warmDeviceSessionHost')>(
          '../../utils/warmDeviceSessionHost'
        ).runOnWarmIosSimulatorAsync
      );
    return stopWarm;
  }

  it.each(['event collection', 'Appium process'])(
    'waits for warm %s teardown before finishing the session host',
    async stage => {
      mockWarmSession();
      stopAppium.mockResolvedValue(undefined);
      let finishTeardown = () => {};
      const teardownGate = new Promise<void>(resolve => {
        finishTeardown = resolve;
      });
      let startedTeardown = () => {};
      const teardownStarted = new Promise<void>(resolve => {
        startedTeardown = resolve;
      });
      const stop = async () => {
        startedTeardown();
        await teardownGate;
      };
      (stage === 'event collection' ? stopEventCollection : stopAppium).mockImplementationOnce(
        stop
      );

      const running = runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {}, true);
      try {
        await teardownStarted;
        await Promise.resolve();
        expect(finishHost).not.toHaveBeenCalled();
        if (stage === 'event collection') {
          expect(stopAppium).not.toHaveBeenCalled();
        }
      } finally {
        finishTeardown();
        await running;
      }
      expect(finishHost).toHaveBeenCalledTimes(1);
      expect(stopAppium.mock.invocationCallOrder[0]).toBeLessThan(
        finishHost.mock.invocationCallOrder[0]
      );
      const home = jest.mocked(spawnDetached).mock.calls[0][0].env.APPIUM_HOME;
      expect(fs.existsSync(home ?? '')).toBe(false);
    }
  );

  it.each(['event collection', 'Appium process'])(
    'finishes the warm host after %s teardown fails',
    async stage => {
      const stopWarm = mockWarmSession();
      stopAppium.mockResolvedValue(undefined);
      const error = new Error(`${stage} stop failed`);
      (stage === 'event collection' ? stopEventCollection : stopAppium).mockRejectedValueOnce(
        error
      );

      await expect(
        runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {}, true)
      ).rejects.toBe(error);

      expect(stopAppium).toHaveBeenCalledTimes(1);
      expect(finishHost).toHaveBeenCalledTimes(1);
      expect(stopWarm).toHaveBeenCalledTimes(1);
      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
    }
  );

  it.each([false, true])(
    'finishes a cold host while Appium is still stopping (warm step: %s)',
    async warm => {
      if (warm) {
        jest.mocked(runOnWarmIosSimulatorAsync).mockImplementationOnce((_claim, run) => run());
      }
      let finishAppium = () => {};
      const appiumGate = new Promise<void>(resolve => {
        finishAppium = resolve;
      });
      let startedAppiumStop = () => {};
      const appiumStopping = new Promise<void>(resolve => {
        startedAppiumStop = resolve;
      });
      stopAppium.mockImplementationOnce(async () => {
        startedAppiumStop();
        await appiumGate;
      });
      let startedHostFinish = () => {};
      const hostFinishing = new Promise<void>(resolve => {
        startedHostFinish = resolve;
      });
      finishHost.mockImplementationOnce(async () => startedHostFinish());

      const running = runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {}, warm);
      try {
        await appiumStopping;
        await Promise.resolve();
        expect(finishHost).toHaveBeenCalledTimes(1);
        await hostFinishing;
      } finally {
        finishAppium();
        await running;
      }
    }
  );

  it.each(['stopped', 'process stop failed', 'home cleanup failed'])(
    'retries a failed warm adoption only after Appium stops (%s)',
    async cleanup => {
      const stopFails = cleanup === 'process stop failed';
      const adoptionError = new WarmSessionAdoptionError();
      const stopWarm = mockWarmSession();
      let failHost: (error: Error) => void = () => {};
      jest.mocked(startDeviceSessionHostAsync).mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          failHost = reject;
        })
      );
      jest.mocked(spawnDetached).mockImplementationOnce(() => {
        failHost(adoptionError);
        return {
          pid: 4242,
          getOutput: () => '',
          getExitError: () => undefined,
          stopAsync: stopAppium,
        };
      });
      if (!stopFails) {
        stopAppium.mockResolvedValue(undefined);
      }
      if (cleanup === 'home cleanup failed') {
        jest.spyOn(fs.promises, 'rm').mockRejectedValueOnce(new Error('home cleanup failed'));
      }

      const running = runSessionAsync(
        { info: jest.fn(), warn: jest.fn() },
        undefined,
        BuildRuntimePlatform.DARWIN,
        { boot_simulator: { value: true }, device_identifier: { value: 'iPhone 17' } },
        true
      );

      if (stopFails) {
        await expect(running).rejects.toMatchObject({ errors: [adoptionError, stopError] });
        expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
        expect(stopWarm).toHaveBeenCalledTimes(1);
      } else {
        await expect(running).resolves.toBeUndefined();
        expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(2);
        expect(stopWarm).toHaveBeenCalledTimes(1);
      }
      expect(stopAppium).toHaveBeenCalledTimes(stopFails ? 1 : 2);
      if (cleanup === 'home cleanup failed') {
        const home = jest.mocked(spawnDetached).mock.calls[0][0].env.APPIUM_HOME;
        if (home) {
          await fs.promises.rm(home, { recursive: true, force: true });
        }
      }
    }
  );
  it.each([
    [BuildRuntimePlatform.LINUX, false],
    [BuildRuntimePlatform.DARWIN, false],
    [BuildRuntimePlatform.DARWIN, true],
  ])(
    'handles Stop during the readiness retry sleep on %s with startup=%s',
    async (runtimePlatform, bootSimulator) => {
      stopAppium.mockResolvedValue(undefined);
      jest
        .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
        .mockResolvedValue([{ udid: 'chosen-ios-udid' } as never]);
      jest.mocked(turtleFetch).mockResolvedValue({ ok: false } as never);
      jest.mocked(timersPromises.setTimeout).mockImplementationOnce((async (ms, value, options) => {
        const sleeping = jest.requireActual('node:timers/promises').setTimeout(ms, value, options);
        jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value.stop();
        return sleeping;
      }) as typeof timersPromises.setTimeout);
      await expect(
        runSessionAsync(
          logger,
          undefined,
          runtimePlatform,
          bootSimulator
            ? { boot_simulator: { value: true }, device_identifier: { value: 'chosen-device' } }
            : {}
        )
      ).resolves.toBeUndefined();
      expect(stopAppium).toHaveBeenCalledTimes(1);
      expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
      expect(waitForDeviceRunSessionStoppedAsync).not.toHaveBeenCalled();
    }
  );

  it('does not open the preview after Stop while the Appium tunnel is opening', async () => {
    stopAppium.mockResolvedValue(undefined);
    let tunnelEntered!: () => void;
    const entered = new Promise<void>(resolve => {
      tunnelEntered = resolve;
    });
    let finishTunnel!: () => void;
    const pendingTunnel = new Promise<void>(resolve => {
      finishTunnel = resolve;
    });
    const stopTunnel = jest.fn();
    jest.mocked(startNgrokTunnelAsync).mockImplementationOnce(async () => {
      tunnelEntered();
      await pendingTunnel;
      return { url: 'https://appium.example.com', subdomainId: 'appium', stopAsync: stopTunnel };
    });
    const openPreviewAsync = jest.fn();
    const finishHost = jest.fn();
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValueOnce({
      openPreviewAsync,
      finishAsync: finishHost,
      getLastPreviewActivityAt: jest.fn(),
    });
    const running = runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {
      boot_simulator: { value: true },
      device_identifier: { value: 'chosen-device' },
    });
    running.catch(() => {});
    try {
      await entered;
      jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value.stop();
    } finally {
      finishTunnel();
    }
    await expect(running).resolves.toBeUndefined();
    expect(openPreviewAsync).not.toHaveBeenCalled();
    expect(stopTunnel).toHaveBeenCalledTimes(1);
    expect(finishHost).toHaveBeenCalledTimes(1);
    expect(stopAppium).toHaveBeenCalledTimes(1);
    expect(waitForDeviceRunSessionStoppedAsync).not.toHaveBeenCalled();
  });

  it('ends normally when Stop interrupts the LOCAL-guard Simulator shutdown', async () => {
    jest
      .mocked(resolveLocalEgressServeSimBootEnvironmentAsync)
      .mockResolvedValueOnce({ SERVE_SIM_ADDITIONAL_DYLIBS: '/guard.dylib' });
    jest
      .mocked(IosSimulatorUtils.getDeviceAsync)
      .mockResolvedValueOnce({ state: 'Booted' } as never);
    let shutdownEntered!: () => void;
    const entered = new Promise<void>(resolve => {
      shutdownEntered = resolve;
    });
    jest.mocked(spawn).mockImplementationOnce((_command, _args, options) => {
      shutdownEntered();
      return new Promise((_resolve, reject) =>
        options!.signal!.addEventListener(
          'abort',
          () => reject(new Error('Shutdown process aborted', { cause: options!.signal!.reason })),
          { once: true }
        )
      ) as ReturnType<typeof spawn>;
    });
    const running = runSessionAsync(logger, undefined, BuildRuntimePlatform.DARWIN, {
      boot_simulator: { value: true },
      device_identifier: { value: 'chosen-device' },
    });
    running.catch(() => {});
    await entered;
    jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value.stop();
    await expect(running).resolves.toBeUndefined();
    expect(ensureFfmpegInstalledOnceAsync).not.toHaveBeenCalled();
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
    expect(spawnDetached).not.toHaveBeenCalled();
    expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
    expect(waitForDeviceRunSessionStoppedAsync).not.toHaveBeenCalled();
  });

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

  it.each([
    [BuildRuntimePlatform.DARWIN, false],
    [BuildRuntimePlatform.LINUX, false],
    [BuildRuntimePlatform.DARWIN, true],
  ])(
    'handles Stop during %s setup, preserving teardown failure=%s',
    async (runtimePlatform, teardownFails) => {
      let setupEntered!: () => void;
      const entered = new Promise<void>(resolve => {
        setupEntered = resolve;
      });
      jest.mocked(ensureFfmpegInstalledOnceAsync).mockImplementationOnce(({ signal }) => {
        setupEntered();
        return new Promise<void>(resolve =>
          signal!.addEventListener('abort', () => resolve(), { once: true })
        );
      });
      const teardownError = new Error('host teardown failed');
      const finishHost = jest.fn().mockImplementation(async () => {
        if (teardownFails) {
          throw teardownError;
        }
      });
      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        jest.mocked(startDeviceSessionHostAsync).mockResolvedValueOnce({
          openPreviewAsync: jest.fn(),
          finishAsync: finishHost,
          getLastPreviewActivityAt: () => undefined,
        });
      }
      const running = runSessionAsync(
        { info: jest.fn(), warn: jest.fn() },
        undefined,
        runtimePlatform,
        runtimePlatform === BuildRuntimePlatform.DARWIN
          ? { boot_simulator: { value: true }, device_identifier: { value: 'chosen-ios-udid' } }
          : {}
      );
      running.catch(() => {});
      await entered;
      const watch = jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value;
      watch.stop();
      if (teardownFails) {
        await expect(running).rejects.toBe(teardownError);
      } else {
        await expect(running).resolves.toBeUndefined();
      }
      expect(spawnDetached).not.toHaveBeenCalled();
      expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
      expect(watch.finishAsync).toHaveBeenCalled();
      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        expect(finishHost).toHaveBeenCalledTimes(1);
      }
    }
  );

  it.each([
    [BuildRuntimePlatform.DARWIN, false],
    [BuildRuntimePlatform.DARWIN, true],
    [BuildRuntimePlatform.LINUX, false],
  ])(
    'preserves failed installer cleanup after Stop on %s with Simulator startup=%s',
    async (runtimePlatform, bootSimulator) => {
      const cleanupError = new Error('Appium home removal failed: EACCES');
      const remove = fs.promises.rm.bind(fs.promises);
      jest
        .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
        .mockResolvedValue([{ udid: 'chosen-ios-udid' } as never]);
      let enteredInstall!: () => void;
      const installEntered = new Promise<void>(resolve => {
        enteredInstall = resolve;
      });
      let closeInstaller!: (error: Error) => void;
      jest.mocked(spawn).mockImplementationOnce(() => {
        enteredInstall();
        return Object.assign(
          new Promise((_resolve, reject) => {
            closeInstaller = reject;
          }),
          { child: { pid: 12345 } }
        ) as never;
      });
      jest.spyOn(processes, 'killProcessGroup').mockImplementation(() => {});
      const rm = jest.spyOn(fs.promises, 'rm').mockRejectedValueOnce(cleanupError);
      const running = runSessionAsync(
        { info: jest.fn(), warn: jest.fn() },
        undefined,
        runtimePlatform,
        bootSimulator
          ? { boot_simulator: { value: true }, device_identifier: { value: 'chosen-ios-udid' } }
          : {}
      );
      const observed = running.catch(() => {});
      let home: string | undefined;
      try {
        await installEntered;
        home = jest.mocked(spawn).mock.calls[0][2]?.cwd as string;
        const watch = jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value;
        watch.stop();
        closeInstaller(new Error('installer interrupted'));
        await expect(running).rejects.toBe(cleanupError);
        expect(rm).toHaveBeenCalledWith(home, { recursive: true, force: true });
        expect(fs.existsSync(home)).toBe(true);
        expect(spawnDetached).not.toHaveBeenCalled();
        expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
        expect(watch.finishAsync).toHaveBeenCalled();
      } finally {
        closeInstaller?.(new Error('test cleanup'));
        await observed;
        if (home) {
          await remove(home, { recursive: true, force: true });
        }
      }
    }
  );

  it('preserves an Android installer failure observed before a later Stop', async () => {
    const failed = new Error('Appium install failed first');
    let observedFailure!: () => void;
    const installFailed = new Promise<void>(resolve => {
      observedFailure = resolve;
    });
    jest.mocked(spawn).mockImplementationOnce((() => {
      observedFailure();
      return Promise.reject(failed);
    }) as never);
    jest
      .mocked(ensureFfmpegInstalledOnceAsync)
      .mockImplementationOnce(
        ({ signal }) =>
          new Promise<void>(resolve =>
            signal!.addEventListener('abort', () => resolve(), { once: true })
          )
      );
    const running = runSessionAsync(
      { info: jest.fn(), warn: jest.fn() },
      undefined,
      BuildRuntimePlatform.LINUX
    );
    running.catch(() => {});
    await installFailed;
    await new Promise(resolve => setImmediate(resolve));
    const watch = jest.mocked(watchDeviceRunSessionStartup).mock.results[0].value;
    watch.stop();
    await expect(running).rejects.toBe(failed);
    expect(spawnDetached).not.toHaveBeenCalled();
  });

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
    jest.mocked(timersPromises.setTimeout).mockImplementation((async ms => {
      now += Number(ms ?? 0);
    }) as typeof timersPromises.setTimeout);
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
