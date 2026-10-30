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
import { readIosApplicationIdentifierAsync } from '../../utils/iosAppArtifact';
import { launchApplicationAsync } from '../launchApplication';
import {
  getAgentDeviceRemoteSessionEnvOrThrow,
  runAgentDeviceRemoteSessionAsync,
} from '../startAgentDeviceRemoteSession';
import { runOnWarmIosSimulatorAsync } from '../../utils/warmDeviceSessionHost';
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
jest.mock('../../utils/warmDeviceSessionHost');
jest.mock('../downloadBuild', () => ({ downloadBuildAsync: jest.fn() }));
jest.mock('../installBuild', () => ({ installBuildAsync: jest.fn() }));
jest.mock('../../utils/iosAppArtifact', () => ({
  ...jest.requireActual('../../utils/iosAppArtifact'),
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
  signal?: AbortSignal,
  stepCtx: CustomBuildContext = ctx,
  warm = false
): Promise<void> {
  const buildFunction = createStartAgentDeviceSessionBuildFunction(stepCtx, { warm });
  const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
  const inputs = Object.fromEntries(
    [
      'device_identifier',
      'system_image_package',
      'lcd_width',
      'lcd_height',
      'lcd_density',
      'install_app_path',
      'build_id',
      'application_archive_url',
      'launch_app_identifier',
      'launch_args',
      'open_url',
      'network_capture',
      'network_capture_fields',
      'public_preview',
      'private_preview_url',
      'frame_ancestors',
      'cors_origins',
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
      install_app_path: '/tmp/App.app',
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

  it('fails before app installation or host startup when guarded device shutdown fails', async () => {
    jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue({
      SERVE_SIM_ADDITIONAL_DYLIBS: '/w/bin/egress-guard.dylib',
    });
    jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({ state: 'Booted' } as never);
    jest.mocked(spawn).mockRejectedValue(new Error('shutdown failed'));
    await expect(
      runStep(BuildRuntimePlatform.DARWIN, { install_app_path: '/tmp/App.app' })
    ).rejects.toThrow('shutdown failed');

    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
    expect(stopLocalEgressResourcesAsync).toHaveBeenCalledTimes(1);
  });

  it('provides Simulator preparation and local app startup options to the remote session', async () => {
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
      install_app_path: '/tmp/App.app',
      launch_args: ['-flag'],
      open_url: 'exp://example.test',
    });
    await flushAsync();
    expect(IosSimulatorUtils.resolveUdidAsync).toHaveBeenCalledWith({
      deviceIdentifier: 'iPhone 17',
      env: {},
    });
    expect(bootIosSimulatorAsync).not.toHaveBeenCalled();

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

  it('fails a guarded session before app installation or host startup if its boot files are missing', async () => {
    jest
      .mocked(resolveLocalEgressServeSimBootEnvironmentAsync)
      .mockRejectedValue(new Error('missing bin/egress-guard-check'));
    await expect(
      runStep(BuildRuntimePlatform.DARWIN, { install_app_path: '/tmp/App.app' })
    ).rejects.toThrow('missing bin/egress-guard-check');
    expect(startLocalEgressGuardRelayAsync).not.toHaveBeenCalled();

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
    await expect(
      runStep(BuildRuntimePlatform.DARWIN, { install_app_path: '/tmp/App.app' })
    ).rejects.toThrow('guard check failed');
    expect(startLocalEgressGuardRelayAsync).toHaveBeenCalledTimes(1);
    expect(stopLocalEgressResourcesAsync).toHaveBeenCalledTimes(1);
    expect(installBuildAsync).not.toHaveBeenCalled();
    expect(launchApplicationAsync).not.toHaveBeenCalled();
  });

  it('passes the selected Simulator to the host even when there is no app', async () => {
    await runStep(BuildRuntimePlatform.DARWIN);

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
      install_app_path: '/tmp/App.app',
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

    expect(launchApplicationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ applicationIdentifier: 'dev.example.app', activityName: '.Main' })
    );
  });

  it('does not start work for an already cancelled step', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      runStep(BuildRuntimePlatform.DARWIN, { install_app_path: '/tmp/App.app' }, controller.signal)
    ).rejects.toThrow('cancelled');
    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();

    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });

  it('does not start device or app work after cancellation during Xcode selection', async () => {
    const controller = new AbortController();
    const selected = deferred();
    jest.mocked(selectXcodeDeveloperDirectoryAsync).mockReturnValue(selected.promise);
    const step = runStep(
      BuildRuntimePlatform.DARWIN,
      { install_app_path: '/tmp/App.app' },
      controller.signal
    );
    const failure = expect(step).rejects.toThrow('cancelled');
    await flushAsync();
    controller.abort(new Error('cancelled'));
    selected.resolve();

    await failure;
    expect(IosSimulatorUtils.resolveUdidAsync).not.toHaveBeenCalled();
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
      'install_app_path',
      'build_id',
      'application_archive_url',
      'launch_app_identifier',
      'launch_args',
      'open_url',
      'network_capture',
      'network_capture_fields',
      'public_preview',
      'private_preview_url',
      'frame_ancestors',
      'cors_origins',
      'package_version',
      'max_idle_time_minutes',
      'max_duration_seconds',
    ]);
  });

  it.each([undefined, true, false])(
    'passes public_preview=%s to the iOS session host',
    async publicPreview => {
      await runStep(BuildRuntimePlatform.DARWIN, {
        public_preview: publicPreview,
        private_preview_url: 'https://expo.dev/private-preview',
      });
      expect(runAgentDeviceRemoteSessionAsync).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          disableShare: publicPreview === false,
          privatePreviewUrl: 'https://expo.dev/private-preview',
        })
      );
    }
  );

  it('passes frame_ancestors to the session host', async () => {
    await runStep(BuildRuntimePlatform.DARWIN, {
      frame_ancestors: ['https://embed.example.test'],
    });
    expect(runAgentDeviceRemoteSessionAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ frameAncestors: ['https://embed.example.test'] })
    );
  });

  it('passes cors_origins to the session host', async () => {
    await runStep(BuildRuntimePlatform.DARWIN, {
      cors_origins: ['https://app.example.test'],
    });
    expect(runAgentDeviceRemoteSessionAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ corsOrigins: ['https://app.example.test'] })
    );
  });

  it.each([
    ['argument count', { launch_args: Array(257).fill('a') }],
    ['argument length', { launch_args: ['a'.repeat(9000)] }],
    ['NUL argument', { launch_args: ['a\u0000b'] }],
    ['total UTF-8 bytes', { launch_args: Array(8).fill('😃'.repeat(4096)) }],
    ['NUL URL', { open_url: 'example:\u0000screen' }],
    ['URL length', { open_url: `example://${'a'.repeat(8192)}` }],
  ])('rejects iOS launch %s before startup work', async (_name, inputs) => {
    const step = runStep(BuildRuntimePlatform.DARWIN, {
      install_app_path: '/tmp/App.app',
      ...inputs,
    });
    await expect(step).rejects.toBeInstanceOf(UserError);
    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();
    expect(IosSimulatorUtils.resolveUdidAsync).not.toHaveBeenCalled();
    expect(bootIosSimulatorAsync).not.toHaveBeenCalled();

    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['NUL argument', { launch_args: ['a\u0000b'] }],
    ['command length', { launch_args: ['--es', 'quotes', "'".repeat(20_000)] }],
    ['NUL URL', { open_url: 'example:\u0000screen' }],
  ])('rejects Android launch %s before startup work', async (_name, inputs) => {
    const step = runStep(BuildRuntimePlatform.LINUX, {
      install_app_path: '/tmp/App.app',
      ...inputs,
    });
    await expect(step).rejects.toMatchObject({ errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT' });
    expect(startAndroidEmulatorAsync).not.toHaveBeenCalled();

    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });

  it('keeps Android launch inputs on its existing direct path', async () => {
    const launchArgs = ['a'.repeat(9000)];
    await runStep(BuildRuntimePlatform.LINUX, {
      install_app_path: '/tmp/App.app',
      launch_args: launchArgs,
    });
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
  it('requires an application for launch options before starting the device', async () => {
    await expect(
      runStep(BuildRuntimePlatform.DARWIN, { open_url: 'fixture://route' })
    ).rejects.toThrow('pass install_app_path or launch_app_identifier');
    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();
    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });

  it('launches an installed iOS application without reading an app artifact', async () => {
    await runStep(BuildRuntimePlatform.DARWIN, {
      launch_app_identifier: 'dev.installed.app',
      launch_args: ['--test'],
      open_url: 'fixture://route',
    });
    expect(readIosApplicationIdentifierAsync).not.toHaveBeenCalled();
    expect(deviceLaunch).toEqual({
      installAppPath: undefined,
      launchAppIdentifier: 'dev.installed.app',
      launchArgs: ['--test'],
      openUrl: 'fixture://route',
    });
  });

  it('keeps explicit application identifier launch iOS-only', async () => {
    await expect(
      runStep(BuildRuntimePlatform.LINUX, { launch_app_identifier: 'dev.app' })
    ).rejects.toThrow('Pass install_app_path for Android');
    expect(startAndroidEmulatorAsync).not.toHaveBeenCalled();
  });

  it('still downloads a build_id app and launches it on iOS', async () => {
    jest.mocked(downloadBuildAsync).mockResolvedValue({ artifactPath: '/tmp/Downloaded.app' });
    await runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id', launch_args: ['-flag'] });
    expect(downloadBuildAsync).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: 'build-id', extensions: ['app'] })
    );
    expect(deviceLaunch).toEqual({
      installAppPath: '/tmp/Downloaded.app',
      launchAppIdentifier: 'dev.example.app',
      launchArgs: ['-flag'],
      openUrl: undefined,
    });
  });

  it('still downloads an application_archive_url app and installs it on Android', async () => {
    jest.mocked(downloadBuildAsync).mockResolvedValue({ artifactPath: '/tmp/Downloaded.apk' });
    await runStep(BuildRuntimePlatform.LINUX, {
      application_archive_url: 'https://example.test/app.tar.gz',
    });
    expect(downloadBuildAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationArchiveUrl: 'https://example.test/app.tar.gz',
        extensions: ['apk'],
      })
    );
    expect(installBuildAsync).toHaveBeenCalledWith(
      expect.objectContaining({ artifactPath: '/tmp/Downloaded.apk' })
    );
    expect(launchApplicationAsync).toHaveBeenCalledTimes(1);
  });

  it('runs the warm step on the warm Simulator for a local app only', async () => {
    jest.mocked(runOnWarmIosSimulatorAsync).mockImplementation((_claim, run) => run());
    const runWarm = (inputs: Record<string, unknown>) =>
      runStep(BuildRuntimePlatform.DARWIN, inputs, undefined, ctx, true);
    await runWarm({ install_app_path: '/tmp/App.app', device_identifier: 'iPhone 17' });
    expect(runOnWarmIosSimulatorAsync).toHaveBeenCalledWith(
      expect.objectContaining({ engine: 'agent-device', requestedDevice: 'iPhone 17' }),
      expect.any(Function)
    );
    jest.mocked(runOnWarmIosSimulatorAsync).mockClear();
    jest.mocked(downloadBuildAsync).mockResolvedValue({ artifactPath: '/tmp/Downloaded.app' });
    await runWarm({ build_id: 'build-id' });
    expect(runOnWarmIosSimulatorAsync).not.toHaveBeenCalled();
    expect(runAgentDeviceRemoteSessionAsync).toHaveBeenCalledTimes(2);
  });

  it('accepts only one application source', async () => {
    await expect(
      runStep(BuildRuntimePlatform.DARWIN, { install_app_path: '/tmp/App.app', build_id: 'id' })
    ).rejects.toThrow('Pass only one of install_app_path, build_id or application_archive_url.');
    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });

  it('waits for Android boot before installing the supplied local APK', async () => {
    const boot = deferred();
    jest.mocked(startAndroidEmulatorAsync).mockReturnValue(boot.promise as never);
    const step = runStep(BuildRuntimePlatform.LINUX, { install_app_path: '/tmp/App.apk' });
    await flushAsync();
    expect(installBuildAsync).not.toHaveBeenCalled();
    boot.resolve();
    await step;
    expect(installBuildAsync).toHaveBeenCalledWith(
      expect.objectContaining({ artifactPath: '/tmp/App.apk' })
    );
    expect(launchApplicationAsync).toHaveBeenCalledTimes(1);
  });

  it('drains an in-flight Android install on cancellation and never launches it', async () => {
    const controller = new AbortController();
    const installation = deferred<{ applicationIdentifier: string; activityName: string }>();
    jest.mocked(installBuildAsync).mockReturnValue(installation.promise);
    const step = runStep(
      BuildRuntimePlatform.LINUX,
      { install_app_path: '/tmp/App.apk' },
      controller.signal
    );
    let settled = false;
    void step.then(
      () => (settled = true),
      () => (settled = true)
    );
    const failure = expect(step).rejects.toThrow('cancelled');
    await flushAsync();
    expect(installBuildAsync).toHaveBeenCalledTimes(1);
    controller.abort(new Error('cancelled'));
    await flushAsync();
    expect(settled).toBe(false);
    installation.resolve({ applicationIdentifier: 'dev.app', activityName: '.Main' });
    await failure;
    expect(launchApplicationAsync).not.toHaveBeenCalled();
  });

  it('drains an in-flight Android install when session startup fails', async () => {
    const entered = deferred();
    const installation = deferred<{ applicationIdentifier: string; activityName: string }>();
    jest.mocked(installBuildAsync).mockImplementation(() => {
      entered.resolve();
      return installation.promise;
    });
    jest.mocked(runAgentDeviceRemoteSessionAsync).mockImplementation(async () => {
      await entered.promise;
      throw new Error('session startup failed');
    });
    const step = runStep(BuildRuntimePlatform.LINUX, { install_app_path: '/tmp/App.apk' });
    let settled = false;
    void step.then(
      () => (settled = true),
      () => (settled = true)
    );
    const failure = expect(step).rejects.toThrow('session startup failed');
    await entered.promise;
    await flushAsync();
    expect(settled).toBe(false);
    installation.resolve({ applicationIdentifier: 'dev.app', activityName: '.Main' });
    await failure;
    expect(launchApplicationAsync).not.toHaveBeenCalled();
  });

  it('drains iOS metadata reading on cancellation without starting the session', async () => {
    const controller = new AbortController();
    const metadata = deferred<string>();
    jest.mocked(readIosApplicationIdentifierAsync).mockReturnValue(metadata.promise);
    const step = runStep(
      BuildRuntimePlatform.DARWIN,
      { install_app_path: '/tmp/App.app' },
      controller.signal
    );
    const failure = expect(step).rejects.toThrow('cancelled');
    await flushAsync();
    expect(readIosApplicationIdentifierAsync).toHaveBeenCalledTimes(1);
    controller.abort(new Error('cancelled'));
    metadata.resolve('dev.app');
    await failure;
    expect(runAgentDeviceRemoteSessionAsync).not.toHaveBeenCalled();
  });
});
