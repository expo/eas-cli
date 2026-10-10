import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import { UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { type CustomBuildContext } from '../../../customBuildContext';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { stopLocalEgressResourcesAsync } from '../../utils/localEgress';
import {
  resolveLocalEgressServeSimBootEnvironmentAsync,
  startLocalEgressGuardRelayAsync,
} from '../../utils/localEgressGuard';
import { selectXcodeDeveloperDirectoryAsync } from '../../utils/remoteDeviceRunSession';
import { downloadBuildAsync } from '../downloadBuild';
import { installBuildAsync } from '../installBuild';
import { readIosApplicationIdentifierAsync } from '../../utils/serveSimActions';
import { launchApplicationAsync } from '../launchApplication';
import {
  getAgentDeviceRemoteSessionEnvOrThrow,
  runAgentDeviceRemoteSessionAsync,
} from '../startAgentDeviceRemoteSession';
import { createStartAgentDeviceSessionBuildFunction } from '../startAgentDeviceSession';
import { startAndroidEmulatorAsync } from '../startAndroidEmulator';
import { bootIosSimulatorAsync } from '../startIosSimulator';

jest.mock('../../utils/localEgress', () => ({
  stopLocalEgressResourcesAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/localEgressGuard', () => ({
  resolveLocalEgressServeSimBootEnvironmentAsync: jest.fn(),
  startLocalEgressGuardRelayAsync: jest.fn(),
}));
jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/IosSimulatorUtils');
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
}));
jest.mock('../startIosSimulator', () => ({
  ...jest.requireActual('../startIosSimulator'),
  bootIosSimulatorAsync: jest.fn(),
}));
jest.mock('../startAndroidEmulator', () => ({ startAndroidEmulatorAsync: jest.fn() }));
jest.mock('../downloadBuild', () => ({ downloadBuildAsync: jest.fn() }));
jest.mock('../installBuild', () => ({ installBuildAsync: jest.fn() }));
jest.mock('../../utils/serveSimActions', () => ({
  ...jest.requireActual('../../utils/serveSimActions'),
  readIosApplicationIdentifierAsync: jest.fn(),
}));
jest.mock('../launchApplication', () => ({
  ...jest.requireActual('../launchApplication'),
  launchApplicationAsync: jest.fn(),
}));
jest.mock('../startAgentDeviceRemoteSession', () => ({
  getAgentDeviceRemoteSessionEnvOrThrow: jest.fn(),
  runAgentDeviceRemoteSessionAsync: jest.fn(),
}));

const graphqlClient = { query: jest.fn() };
const ctx = { graphqlClient } as unknown as CustomBuildContext;
const sessionEnv = {
  deviceRunSessionId: 'device-run-session-id',
  ngrokTunnelDomain: 'tunnel.example.com',
  ngrokAuthtoken: 'ngrok-token',
};

type Device = Parameters<typeof runAgentDeviceRemoteSessionAsync>[1]['device'];
let deviceLaunch: unknown;

function runDevicePreparationAsync(device: Device): Promise<unknown> {
  return (
    'iosSimulatorUdid' in device ? (device.application ?? Promise.resolve()) : device.ready
  ).then(async launch => {
    deviceLaunch = launch;
    return launch;
  });
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function runStep(
  runtimePlatform: BuildRuntimePlatform,
  inputValues: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<void> {
  const buildFunction = createStartAgentDeviceSessionBuildFunction(ctx);
  const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
  const inputs = Object.fromEntries(
    [
      'device_identifier',
      'system_image_package',
      'lcd_width',
      'lcd_height',
      'lcd_density',
      'build_id',
      'application_archive_url',
      'launch_args',
      'open_url',
      'network_capture',
      'network_capture_fields',
      'package_version',
      'max_idle_time_minutes',
      'max_duration_seconds',
    ].map(id => [id, { value: inputValues[id] }])
  );
  return buildFunction.fn!(
    {
      logger,
      global: {
        runtimePlatform,
        staticContext: { job: { secrets: { robotAccessToken: 'robot-token' } } },
      },
    } as unknown as BuildStepContext,
    { inputs, outputs: {}, env: {}, signal } as never
  ) as Promise<void>;
}

function sessionDevice(): Device {
  return jest.mocked(runAgentDeviceRemoteSessionAsync).mock.calls[0][1].device;
}

describe(createStartAgentDeviceSessionBuildFunction, () => {
  beforeEach(() => {
    deviceLaunch = undefined;
    jest.clearAllMocks();
    jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue(null);
    jest.mocked(startLocalEgressGuardRelayAsync).mockResolvedValue(undefined);
    jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({ state: 'Shutdown' } as never);
    jest.mocked(spawn).mockResolvedValue({ stdout: '' } as never);
    jest.mocked(IosSimulatorUtils.resolveUdidAsync).mockResolvedValue('selected-udid' as never);
    jest
      .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
      .mockResolvedValue([{ name: 'iPhone 17', udid: 'SELECTED-UDID' }] as never);
    jest.mocked(getAgentDeviceRemoteSessionEnvOrThrow).mockReturnValue(sessionEnv);
    jest
      .mocked(runAgentDeviceRemoteSessionAsync)
      .mockImplementation(async (_ctx, { device, tasks }) => {
        await tasks.untilAborted(runDevicePreparationAsync(device));
      });
    jest.mocked(bootIosSimulatorAsync).mockResolvedValue({
      deviceIdentifier: 'iPhone 17' as never,
      udid: 'udid' as never,
      displayName: 'iPhone 17',
    });
    jest.mocked(startAndroidEmulatorAsync).mockResolvedValue({
      serialId: 'emulator-5554' as never,
      emulatorPromise: Promise.resolve(),
      shouldAdjustAnimationScale: true,
    });
    jest.mocked(downloadBuildAsync).mockResolvedValue({ artifactPath: '/tmp/App.app' });
    jest
      .mocked(installBuildAsync)
      .mockResolvedValue({ applicationIdentifier: 'dev.example.app', activityName: '.Main' });
    jest.mocked(launchApplicationAsync).mockResolvedValue(undefined);
    jest.mocked(readIosApplicationIdentifierAsync).mockResolvedValue('dev.example.app');
  });

  it('hands guarded iOS boot to serve-sim and starts reporting before host startup', async () => {
    const bootEnv = {
      SERVE_SIM_ADDITIONAL_DYLIBS: '/w/bin/egress-guard.dylib',
      SIMCTL_CHILD_EAS_EGRESS_GUARD_MODE: 'block',
      SIMCTL_CHILD_http_proxy: 'http://127.0.0.1:8899',
    };
    jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue(bootEnv);
    await runStep(BuildRuntimePlatform.DARWIN, {
      build_id: 'build-id',
      launch_args: ['-flag'],
      open_url: 'exp://example.test',
    });
    expect(
      jest.mocked(selectXcodeDeveloperDirectoryAsync).mock.invocationCallOrder[0]
    ).toBeLessThan(
      jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mock.invocationCallOrder[0]
    );
    expect(startLocalEgressGuardRelayAsync).toHaveBeenCalledTimes(1);
    expect(jest.mocked(startLocalEgressGuardRelayAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(runAgentDeviceRemoteSessionAsync).mock.invocationCallOrder[0]
    );
    expect(bootIosSimulatorAsync).not.toHaveBeenCalled();
    expect(downloadBuildAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        buildId: 'build-id',
        extensions: ['app'],
        graphqlClient,
        robotAccessToken: 'robot-token',
      })
    );
    expect(runAgentDeviceRemoteSessionAsync).toHaveBeenCalledTimes(1);
    const device = sessionDevice();
    expect(device).toEqual({
      iosSimulatorUdid: 'SELECTED-UDID',
      bootEnv,
      application: expect.any(Promise),
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(readIosApplicationIdentifierAsync).toHaveBeenCalledWith({
      artifactPath: '/tmp/App.app',
      env: {},
    });
    expect(installBuildAsync).not.toHaveBeenCalled();
    expect(launchApplicationAsync).not.toHaveBeenCalled();
    expect(deviceLaunch).toEqual({
      installAppPath: '/tmp/App.app',
      launchAppIdentifier: 'dev.example.app',
      launchArgs: ['-flag'],
      openUrl: 'exp://example.test',
    });
  });

  it('shuts down only the selected guarded Booted device before host startup', async () => {
    jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue({
      SERVE_SIM_ADDITIONAL_DYLIBS: '/w/bin/egress-guard.dylib',
    });
    jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({ state: 'Booted' } as never);
    await runStep(BuildRuntimePlatform.DARWIN);
    expect(IosSimulatorUtils.getDeviceAsync).toHaveBeenCalledWith({
      udid: 'SELECTED-UDID',
      env: {},
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('xcrun', ['simctl', 'shutdown', 'SELECTED-UDID'], {
      env: {},
      logger: expect.any(Object),
      signal: expect.any(AbortSignal),
    });
    expect(jest.mocked(spawn).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(runAgentDeviceRemoteSessionAsync).mock.invocationCallOrder[0]
    );
  });

  it('fails before download or host startup when guarded device shutdown fails', async () => {
    jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue({
      SERVE_SIM_ADDITIONAL_DYLIBS: '/w/bin/egress-guard.dylib',
    });
    jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({ state: 'Booted' } as never);
    jest.mocked(spawn).mockRejectedValue(new Error('shutdown failed'));
    await expect(runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' })).rejects.toThrow(
      'shutdown failed'
    );
    expect(downloadBuildAsync).not.toHaveBeenCalled();
    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
    expect(stopLocalEgressResourcesAsync).toHaveBeenCalledTimes(1);
  });

  it('provides Simulator preparation and downloaded startup options to the remote session', async () => {
    const hostReady = deferred();
    jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue({
      SERVE_SIM_ADDITIONAL_DYLIBS: '/w/bin/egress-guard.dylib',
    });
    jest.mocked(runAgentDeviceRemoteSessionAsync).mockImplementation(async (_ctx, { device }) => {
      expect('iosSimulatorUdid' in device).toBe(true);
      if (!('iosSimulatorUdid' in device)) {
        return;
      }
      await hostReady.promise;
      deviceLaunch = await device.application;
    });
    const step = runStep(BuildRuntimePlatform.DARWIN, {
      device_identifier: 'iPhone 17',
      build_id: 'build-id',
      launch_args: ['-flag'],
      open_url: 'exp://example.test',
    });
    await flushAsync();
    expect(IosSimulatorUtils.resolveUdidAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'iPhone 17',
      env: {},
    });
    expect(bootIosSimulatorAsync).not.toHaveBeenCalled();
    expect(downloadBuildAsync).toHaveBeenCalledTimes(1);
    expect(readIosApplicationIdentifierAsync).toHaveBeenCalledWith({
      artifactPath: '/tmp/App.app',
      env: {},
    });
    expect(installBuildAsync).not.toHaveBeenCalled();
    expect(launchApplicationAsync).not.toHaveBeenCalled();
    expect(deviceLaunch).toBeUndefined();
    hostReady.resolve();
    await step;
    expect(deviceLaunch).toEqual({
      installAppPath: '/tmp/App.app',
      launchAppIdentifier: 'dev.example.app',
      launchArgs: ['-flag'],
      openUrl: 'exp://example.test',
    });
  });

  it('fails a guarded session before download or host startup if its boot files are missing', async () => {
    jest
      .mocked(resolveLocalEgressServeSimBootEnvironmentAsync)
      .mockRejectedValue(new Error('missing bin/egress-guard-check'));
    await expect(runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' })).rejects.toThrow(
      'missing bin/egress-guard-check'
    );
    expect(startLocalEgressGuardRelayAsync).not.toHaveBeenCalled();
    expect(downloadBuildAsync).not.toHaveBeenCalled();
    expect(bootIosSimulatorAsync).not.toHaveBeenCalled();
    expect(IosSimulatorUtils.getDeviceAsync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
    expect(stopLocalEgressResourcesAsync).toHaveBeenCalledTimes(1);
  });

  it('releases guard reporting and egress resources when host startup fails', async () => {
    jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue({
      SERVE_SIM_ADDITIONAL_DYLIBS: '/w/bin/egress-guard.dylib',
    });
    jest
      .mocked(runAgentDeviceRemoteSessionAsync)
      .mockRejectedValueOnce(new Error('guard check failed'));
    await expect(runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' })).rejects.toThrow(
      'guard check failed'
    );
    expect(startLocalEgressGuardRelayAsync).toHaveBeenCalledTimes(1);
    expect(stopLocalEgressResourcesAsync).toHaveBeenCalledTimes(1);
    expect(installBuildAsync).not.toHaveBeenCalled();
    expect(launchApplicationAsync).not.toHaveBeenCalled();
  });

  it('waits for the download before handing the app to the host', async () => {
    const download = deferred<{ artifactPath: string }>();
    jest.mocked(downloadBuildAsync).mockReturnValue(download.promise);

    const step = runStep(BuildRuntimePlatform.DARWIN, {
      application_archive_url: 'https://example.test/app.tar.gz',
    });
    await flushAsync();
    expect(installBuildAsync).not.toHaveBeenCalled();

    download.resolve({ artifactPath: '/tmp/App.app' });
    await step;
    expect(readIosApplicationIdentifierAsync).toHaveBeenCalledTimes(1);
    expect(installBuildAsync).not.toHaveBeenCalled();
  });

  it('passes the selected Simulator to the host even when there is no app', async () => {
    await runStep(BuildRuntimePlatform.DARWIN);

    expect(downloadBuildAsync).not.toHaveBeenCalled();
    expect(installBuildAsync).not.toHaveBeenCalled();
    expect(launchApplicationAsync).not.toHaveBeenCalled();
    expect(sessionDevice()).toEqual({
      iosSimulatorUdid: 'SELECTED-UDID',
      bootEnv: undefined,
      application: undefined,
    });
  });

  it('boots the Android Emulator with the device inputs', async () => {
    await runStep(BuildRuntimePlatform.LINUX, {
      device_identifier: 'pixel_7',
      system_image_package: 'system-images;android-35-ext15;google_apis_playstore;x86_64',
      lcd_width: 720,
      lcd_height: 1600,
      lcd_density: 300,
      build_id: 'build-id',
    });

    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();
    expect(startAndroidEmulatorAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceIdentifier: 'pixel_7',
        systemImagePackage: 'system-images;android-35-ext15;google_apis_playstore;x86_64',
        lcdWidth: 720,
        lcdHeight: 1600,
        lcdDensity: 300,
      })
    );
    expect(downloadBuildAsync).toHaveBeenCalledWith(
      expect.objectContaining({ extensions: ['apk'] })
    );
    expect(launchApplicationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ applicationIdentifier: 'dev.example.app', activityName: '.Main' })
    );
  });

  it('fails the session when the download fails, without an unhandled rejection', async () => {
    jest.mocked(downloadBuildAsync).mockRejectedValue(new Error('download failed'));
    await expect(runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' })).rejects.toThrow(
      'download failed'
    );
    expect(installBuildAsync).not.toHaveBeenCalled();
  });

  /** A download that runs until its abort signal fires, like a stalled one. */
  function mockStalledDownload(): { aborted: () => boolean; settled: () => boolean } {
    let aborted = false;
    let settled = false;
    jest.mocked(downloadBuildAsync).mockImplementation(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => {
            aborted = true;
            // Settles a bit later, like a request that winds down.
            setImmediate(() => {
              settled = true;
              reject(new Error('The user aborted a request.'));
            });
          });
        })
    );
    return { aborted: () => aborted, settled: () => settled };
  }

  /** Runs the session like the real one: fails with the daemon, then waits for every part. */
  function mockSessionWithFailingDaemon(beforeFailure?: () => Promise<void>): void {
    jest
      .mocked(runAgentDeviceRemoteSessionAsync)
      .mockImplementation(async (_ctx, { tasks, device }) => {
        const ready = runDevicePreparationAsync(device);
        await beforeFailure?.();
        const daemon = tasks.run('agent-device daemon', async () => {
          throw new Error('daemon failed');
        });
        try {
          await Promise.all([daemon, ready]);
        } finally {
          await Promise.allSettled([daemon, ready]);
        }
      });
  }

  it('stops the download and waits for it when Android boot fails', async () => {
    const download = mockStalledDownload();
    jest.mocked(startAndroidEmulatorAsync).mockRejectedValue(new Error('boot failed'));

    await expect(runStep(BuildRuntimePlatform.LINUX, { build_id: 'build-id' })).rejects.toThrow(
      'boot failed'
    );

    expect(download.aborted()).toBe(true);
    // The step returned only after the download stopped.
    expect(download.settled()).toBe(true);
    expect(installBuildAsync).not.toHaveBeenCalled();
  });

  it('stops a stalled download and does not install when the daemon fails', async () => {
    const download = mockStalledDownload();
    mockSessionWithFailingDaemon();

    await expect(runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' })).rejects.toThrow(
      'daemon failed'
    );

    expect(download.aborted()).toBe(true);
    expect(download.settled()).toBe(true);
    expect(installBuildAsync).not.toHaveBeenCalled();
    expect(launchApplicationAsync).not.toHaveBeenCalled();
  });

  it('drains the download when host startup fails before app preparation', async () => {
    const download = mockStalledDownload();
    jest.mocked(runAgentDeviceRemoteSessionAsync).mockRejectedValue(new Error('host failed'));

    await expect(runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' })).rejects.toThrow(
      'host failed'
    );
    expect(download.aborted()).toBe(true);
    expect(download.settled()).toBe(true);
    expect(installBuildAsync).not.toHaveBeenCalled();
  });

  it('does not start work for an already cancelled step', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' }, controller.signal)
    ).rejects.toThrow('cancelled');
    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();
    expect(downloadBuildAsync).not.toHaveBeenCalled();
    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });

  it('cancels and drains a pending download through the external signal', async () => {
    const controller = new AbortController();
    const download = mockStalledDownload();
    const step = runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' }, controller.signal);
    const failure = expect(step).rejects.toThrow('cancelled');
    await flushAsync();
    controller.abort(new Error('cancelled'));

    await failure;
    expect(download.aborted()).toBe(true);
    expect(download.settled()).toBe(true);
    expect(installBuildAsync).not.toHaveBeenCalled();
  });

  it('does not start device or download work after cancellation during Xcode selection', async () => {
    const controller = new AbortController();
    const selected = deferred();
    jest.mocked(selectXcodeDeveloperDirectoryAsync).mockReturnValue(selected.promise);
    const step = runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' }, controller.signal);
    const failure = expect(step).rejects.toThrow('cancelled');
    await flushAsync();
    controller.abort(new Error('cancelled'));
    selected.resolve();

    await failure;
    expect(IosSimulatorUtils.resolveUdidAsync).not.toHaveBeenCalled();
    expect(bootIosSimulatorAsync).not.toHaveBeenCalled();
    expect(downloadBuildAsync).not.toHaveBeenCalled();
    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });

  it('drains app preparation when the daemon fails', async () => {
    const metadata = deferred<string>();
    const metadataStarted = deferred();
    jest.mocked(readIosApplicationIdentifierAsync).mockImplementation(() => {
      metadataStarted.resolve();
      return metadata.promise;
    });
    mockSessionWithFailingDaemon(async () => {
      await metadataStarted.promise;
      setImmediate(() => metadata.resolve('dev.example.app'));
    });
    await expect(runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' })).rejects.toThrow(
      'daemon failed'
    );
    expect(readIosApplicationIdentifierAsync).toHaveBeenCalledTimes(1);
    expect(installBuildAsync).not.toHaveBeenCalled();
    expect(launchApplicationAsync).not.toHaveBeenCalled();
    expect(deviceLaunch).toBeUndefined();
  });

  it('rejects conflicting application inputs before it boots anything', async () => {
    await expect(
      runStep(BuildRuntimePlatform.DARWIN, {
        build_id: 'build-id',
        application_archive_url: 'https://example.test/app.tar.gz',
      })
    ).rejects.toThrow('Pass only one of build_id or application_archive_url.');
    await expect(
      runStep(BuildRuntimePlatform.DARWIN, { open_url: 'exp://example.test' })
    ).rejects.toThrow('launch_args and open_url need an application');

    expect(bootIosSimulatorAsync).not.toHaveBeenCalled();
    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });

  it('declares the step inputs', () => {
    const buildFunction = createStartAgentDeviceSessionBuildFunction(ctx);
    const globalCtx = createGlobalContextMock();

    expect(
      buildFunction.inputProviders?.map(provider => provider(globalCtx, 'Test step').id)
    ).toEqual([
      'device_identifier',
      'system_image_package',
      'lcd_width',
      'lcd_height',
      'lcd_density',
      'build_id',
      'application_archive_url',
      'launch_args',
      'open_url',
      'network_capture',
      'network_capture_fields',
      'package_version',
      'max_idle_time_minutes',
      'max_duration_seconds',
    ]);
  });

  it.each([
    ['argument count', { launch_args: Array(257).fill('a') }],
    ['argument length', { launch_args: ['a'.repeat(9000)] }],
    ['NUL argument', { launch_args: ['a\u0000b'] }],
    ['total UTF-8 bytes', { launch_args: Array(8).fill('😃'.repeat(4096)) }],
    ['NUL URL', { open_url: 'example:\u0000screen' }],
    ['URL length', { open_url: `example://${'a'.repeat(8192)}` }],
  ])('rejects iOS launch %s before startup work', async (_name, inputs) => {
    const step = runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id', ...inputs });
    await expect(step).rejects.toBeInstanceOf(UserError);
    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();
    expect(IosSimulatorUtils.resolveUdidAsync).not.toHaveBeenCalled();
    expect(bootIosSimulatorAsync).not.toHaveBeenCalled();
    expect(downloadBuildAsync).not.toHaveBeenCalled();
    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });

  it('keeps Android launch inputs on its existing direct path', async () => {
    const launchArgs = ['a'.repeat(9000)];
    await runStep(BuildRuntimePlatform.LINUX, { build_id: 'build-id', launch_args: launchArgs });
    expect(launchApplicationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ runtimePlatform: BuildRuntimePlatform.LINUX, launchArgs })
    );
  });

  it('passes network capture to the session', async () => {
    await runStep(BuildRuntimePlatform.DARWIN, {
      network_capture: true,
      network_capture_fields: ['header', 'response-body'],
    });

    expect(runAgentDeviceRemoteSessionAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        capture: { networkCapture: true, networkCaptureFields: ['header', 'response-body'] },
      })
    );
  });

  it('rejects network capture on Android before it boots anything', async () => {
    await expect(
      runStep(BuildRuntimePlatform.LINUX, { network_capture: true, system_image_package: 'x' })
    ).rejects.toThrow('records traffic through serve-sim on an iOS simulator');
    expect(startAndroidEmulatorAsync).not.toHaveBeenCalled();
    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });
});
