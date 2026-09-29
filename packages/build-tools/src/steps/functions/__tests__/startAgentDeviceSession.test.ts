import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { type CustomBuildContext } from '../../../customBuildContext';
import {
  ensureFfmpegInstalledOnceAsync,
  selectXcodeDeveloperDirectoryAsync,
} from '../../utils/remoteDeviceRunSession';
import { downloadBuildAsync } from '../downloadBuild';
import { installBuildAsync } from '../installBuild';
import { launchApplicationAsync } from '../launchApplication';
import {
  getAgentDeviceRemoteSessionEnvOrThrow,
  runAgentDeviceRemoteSessionAsync,
} from '../startAgentDeviceRemoteSession';
import { createStartAgentDeviceSessionBuildFunction } from '../startAgentDeviceSession';
import { startAndroidEmulatorAsync } from '../startAndroidEmulator';
import { bootIosSimulatorAsync } from '../startIosSimulator';

jest.mock('../../utils/localEgressSession', () => ({
  withLocalEgressSession: (fn: unknown) => fn,
}));
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  ensureFfmpegInstalledOnceAsync: jest.fn(),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
}));
jest.mock('../startIosSimulator', () => ({ bootIosSimulatorAsync: jest.fn() }));
jest.mock('../startAndroidEmulator', () => ({ startAndroidEmulatorAsync: jest.fn() }));
jest.mock('../downloadBuild', () => ({ downloadBuildAsync: jest.fn() }));
jest.mock('../installBuild', () => ({ installBuildAsync: jest.fn() }));
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

type Device = { booted: Promise<unknown>; ready: Promise<unknown> };

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
  inputValues: Record<string, unknown> = {}
): Promise<void> {
  const buildFunction = createStartAgentDeviceSessionBuildFunction(ctx);
  const logger = { info: jest.fn(), warn: jest.fn() };
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
    { inputs, outputs: {}, env: {}, signal: undefined } as never
  ) as Promise<void>;
}

/** The `device` promises handed to the shared agent-device session code. */
function sessionDevice(): Device {
  return jest.mocked(runAgentDeviceRemoteSessionAsync).mock.calls[0][1].device;
}

describe(createStartAgentDeviceSessionBuildFunction, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAgentDeviceRemoteSessionEnvOrThrow).mockReturnValue(sessionEnv);
    jest.mocked(runAgentDeviceRemoteSessionAsync).mockImplementation(async (_ctx, { device }) => {
      await device.ready;
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
  });

  it('downloads the build and starts the session while the iOS Simulator boots', async () => {
    const boot = deferred<Awaited<ReturnType<typeof bootIosSimulatorAsync>>>();
    jest.mocked(bootIosSimulatorAsync).mockReturnValue(boot.promise);

    const step = runStep(BuildRuntimePlatform.DARWIN, {
      build_id: 'build-id',
      launch_args: ['-flag'],
      open_url: 'exp://example.test',
    });
    await flushAsync();

    expect(
      jest.mocked(selectXcodeDeveloperDirectoryAsync).mock.invocationCallOrder[0]
    ).toBeLessThan(jest.mocked(bootIosSimulatorAsync).mock.invocationCallOrder[0]);
    expect(downloadBuildAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        buildId: 'build-id',
        extensions: ['app'],
        graphqlClient,
        robotAccessToken: 'robot-token',
      })
    );
    expect(runAgentDeviceRemoteSessionAsync).toHaveBeenCalledTimes(1);
    // The install needs the booted Simulator.
    expect(installBuildAsync).not.toHaveBeenCalled();

    boot.resolve({
      deviceIdentifier: 'iPhone 17' as never,
      udid: 'udid' as never,
      displayName: '',
    });
    await step;

    expect(installBuildAsync).toHaveBeenCalledWith(
      expect.objectContaining({ artifactPath: '/tmp/App.app' })
    );
    expect(launchApplicationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationIdentifier: 'dev.example.app',
        launchArgs: ['-flag'],
        openUrl: 'exp://example.test',
      })
    );
    expect(jest.mocked(installBuildAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(launchApplicationAsync).mock.invocationCallOrder[0]
    );
  });

  it('waits for the download when the Simulator boots first', async () => {
    const download = deferred<{ artifactPath: string }>();
    jest.mocked(downloadBuildAsync).mockReturnValue(download.promise);

    const step = runStep(BuildRuntimePlatform.DARWIN, {
      application_archive_url: 'https://example.test/app.tar.gz',
    });
    await flushAsync();
    expect(installBuildAsync).not.toHaveBeenCalled();

    download.resolve({ artifactPath: '/tmp/App.app' });
    await step;
    expect(installBuildAsync).toHaveBeenCalledTimes(1);
  });

  it('makes the session ready when the device boots if there is no app', async () => {
    await runStep(BuildRuntimePlatform.DARWIN);

    expect(downloadBuildAsync).not.toHaveBeenCalled();
    expect(installBuildAsync).not.toHaveBeenCalled();
    expect(launchApplicationAsync).not.toHaveBeenCalled();
    await expect(sessionDevice().ready).resolves.toBeUndefined();
  });

  it('boots the Android Emulator with the device inputs and installs ffmpeg in parallel', async () => {
    await runStep(BuildRuntimePlatform.LINUX, {
      device_identifier: 'pixel_7',
      system_image_package: 'system-images;android-35-ext15;google_apis_playstore;x86_64',
      lcd_width: 720,
      lcd_height: 1600,
      lcd_density: 300,
      build_id: 'build-id',
    });

    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();
    expect(ensureFfmpegInstalledOnceAsync).toHaveBeenCalledTimes(1);
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
    const boot = deferred<Awaited<ReturnType<typeof bootIosSimulatorAsync>>>();
    jest.mocked(bootIosSimulatorAsync).mockReturnValue(boot.promise);
    jest.mocked(downloadBuildAsync).mockRejectedValue(new Error('download failed'));

    const stepFailure = expect(
      runStep(BuildRuntimePlatform.DARWIN, { build_id: 'build-id' })
    ).rejects.toThrow('download failed');
    // The download fails while the boot still runs. Nothing inside the step may leave
    // that rejection unhandled; Jest fails the test if it does.
    await flushAsync();
    boot.resolve({
      deviceIdentifier: 'iPhone 17' as never,
      udid: 'udid' as never,
      displayName: '',
    });

    await stepFailure;
    expect(installBuildAsync).not.toHaveBeenCalled();
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
      'package_version',
      'max_idle_time_minutes',
      'max_duration_seconds',
    ]);
  });
});
