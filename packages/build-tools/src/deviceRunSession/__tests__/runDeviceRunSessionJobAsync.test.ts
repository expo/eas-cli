import {
  ArchiveSourceType,
  BuildTrigger,
  DeviceRunSession,
  Platform,
  SystemError,
} from '@expo/eas-build-job';
import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { randomUUID } from 'node:crypto';

import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { CustomBuildContext } from '../../customBuildContext';
import { Datadog } from '../../datadog';
import { collectAndUploadServeSimMetricsAsync } from '../../steps/functions/collectServeSimMetrics';
import { downloadBuildAsync } from '../../steps/functions/downloadBuild';
import { installBuildAsync } from '../../steps/functions/installBuild';
import { launchApplicationAsync } from '../../steps/functions/launchApplication';
import { startAgentDeviceControllerAsync } from '../../steps/functions/startAgentDeviceRemoteSession';
import { bootIosSimulatorAsync } from '../../steps/functions/startIosSimulator';
import { startLocalEgressAsync } from '../../steps/functions/startLocalEgress';
import { uploadIosSimulatorRecordingsAsync } from '../../steps/functions/uploadDeviceRunSessionScreenRecordings';
import { IosSimulatorRecordingUtils } from '../../steps/utils/IosSimulatorRecordingUtils';
import { stopLocalEgressResourcesAsync } from '../../steps/utils/localEgress';
import { uploadRemoteSessionConfigWithLocalEgressAsync } from '../../steps/utils/localEgressSession';
import {
  fetchWebPreviewTurnArgsAsync,
  selectXcodeDeveloperDirectoryAsync,
  startDeviceWebPreviewWithTunnelAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../../steps/utils/remoteDeviceRunSession';
import { ServeSimMetricsRecorder } from '../../steps/utils/serveSimMetricsRecorder';
import { runDeviceRunSessionJobAsync } from '../index';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../datadog', () => ({ Datadog: { distribution: jest.fn() } }));
jest.mock('../../steps/functions/startIosSimulator', () => ({ bootIosSimulatorAsync: jest.fn() }));
jest.mock('../../steps/functions/startAndroidEmulator', () => ({
  startAndroidEmulatorAsync: jest.fn(),
  assertAndroidEmulatorHostSupportAsync: jest.fn(),
}));
jest.mock('../../steps/functions/downloadBuild', () => ({ downloadBuildAsync: jest.fn() }));
jest.mock('../../steps/functions/installBuild', () => ({ installBuildAsync: jest.fn() }));
jest.mock('../../steps/functions/launchApplication', () => ({ launchApplicationAsync: jest.fn() }));
jest.mock('../../steps/functions/startAgentDeviceRemoteSession', () => ({
  startAgentDeviceControllerAsync: jest.fn(),
  createAgentDevicePackageSpec: (version?: string) => `agent-device@${version ?? 'latest'}`,
}));
jest.mock('../../steps/functions/startArgentRemoteSession', () => ({
  startArgentControllerAsync: jest.fn(),
  ARGENT_PACKAGE_NAME: '@swmansion/argent',
}));
jest.mock('../../steps/functions/startAppiumRemoteSession', () => ({
  startAppiumControllerAsync: jest.fn(),
  installAppiumAsync: jest.fn(),
  resolveAppium3VersionSpec: (version?: string) => version ?? '^3',
  resolveAppiumDriverName: () => 'xcuitest',
}));
jest.mock('../../steps/functions/startLocalEgress', () => ({ startLocalEgressAsync: jest.fn() }));
jest.mock('../../steps/functions/uploadDeviceRunSessionScreenRecordings', () => ({
  uploadIosSimulatorRecordingsAsync: jest.fn(),
}));
jest.mock('../../steps/functions/collectServeSimMetrics', () => ({
  collectAndUploadServeSimMetricsAsync: jest.fn(),
}));
jest.mock('../../steps/utils/IosSimulatorRecordingUtils', () => ({
  IosSimulatorRecordingUtils: { startAsync: jest.fn(), finishAsync: jest.fn() },
}));
jest.mock('../../steps/utils/serveSimMetricsRecorder', () => ({
  ServeSimMetricsRecorder: { startAsync: jest.fn() },
}));
jest.mock('../../steps/utils/remoteDeviceRunSession', () => ({
  startDeviceWebPreviewWithTunnelAsync: jest.fn(),
  fetchWebPreviewTurnArgsAsync: jest.fn(),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
  getNgrokAuthtokenOrThrow: jest.fn(() => 'ngrok-token'),
}));
jest.mock('../../steps/utils/localEgressSession', () => ({
  uploadRemoteSessionConfigWithLocalEgressAsync: jest.fn(),
}));
jest.mock('../../steps/utils/localEgress', () => ({ stopLocalEgressResourcesAsync: jest.fn() }));

const mocked = {
  spawn: jest.mocked(spawn),
  boot: jest.mocked(bootIosSimulatorAsync),
  download: jest.mocked(downloadBuildAsync),
  install: jest.mocked(installBuildAsync),
  launch: jest.mocked(launchApplicationAsync),
  agentDevice: jest.mocked(startAgentDeviceControllerAsync),
  localEgress: jest.mocked(startLocalEgressAsync),
  uploadRecordings: jest.mocked(uploadIosSimulatorRecordingsAsync),
  collectMetrics: jest.mocked(collectAndUploadServeSimMetricsAsync),
  recordings: jest.mocked(IosSimulatorRecordingUtils),
  metricsRecorder: jest.mocked(ServeSimMetricsRecorder),
  preview: jest.mocked(startDeviceWebPreviewWithTunnelAsync),
  turn: jest.mocked(fetchWebPreviewTurnArgsAsync),
  selectXcode: jest.mocked(selectXcodeDeveloperDirectoryAsync),
  wait: jest.mocked(waitForDeviceRunSessionStoppedAsync),
  publish: jest.mocked(uploadRemoteSessionConfigWithLocalEgressAsync),
  stopEgress: jest.mocked(stopLocalEgressResourcesAsync),
  datadog: jest.mocked(Datadog),
};

const previewStopAsync = jest.fn();
const controllerStopAsync = jest.fn();

function createJob(overrides: Partial<DeviceRunSession.Job> = {}): DeviceRunSession.Job {
  return {
    type: DeviceRunSession.JobType.DEVICE_RUN_SESSION,
    triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
    projectArchive: { type: ArchiveSourceType.NONE },
    secrets: { robotAccessToken: 'robot-token', environmentSecrets: [] },
    expoDevUrl: 'https://expo.dev/',
    builderEnvironment: { image: 'latest', env: {} },
    initiatingUserId: randomUUID(),
    appId: randomUUID(),
    session: {
      id: 'session-id',
      controller: DeviceRunSession.Controller.WEB_PREVIEW_ONLY,
      maxDurationSeconds: 900,
      ngrokTunnelDomain: 'sim.example.test',
    },
    device: { platform: Platform.IOS, deviceIdentifier: 'iPhone 16' },
    application: {
      source: { buildId: '9a2f2f1e-5d1e-4a6e-9a1f-9e2c1c6c0b11' },
      launchArgs: ['-flag'],
      openUrl: 'exp://127.0.0.1:8081',
    },
    ...overrides,
  };
}

function createContext(
  job: DeviceRunSession.Job,
  env: Record<string, string> = {}
): BuildContext<DeviceRunSession.Job> {
  return new BuildContext<DeviceRunSession.Job>(job, {
    env: { __API_SERVER_URL: 'http://api.expo.test', ...env },
    logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
    logger: createMockLogger(),
    uploadArtifact: jest.fn(),
    workingdir: '',
  });
}

function callOrder(fn: jest.Mock | jest.MockedFunction<any>): number {
  return fn.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
}

describe(runDeviceRunSessionJobAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CustomBuildContext.prototype, 'runtimePlatform', 'get')
      .mockReturnValue(BuildRuntimePlatform.DARWIN);
    mocked.spawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
    mocked.boot.mockResolvedValue({
      udid: 'UDID' as never,
      deviceIdentifier: 'iPhone 16' as never,
      displayName: 'iPhone 16 (18.0)',
    });
    mocked.download.mockResolvedValue({ artifactPath: '/tmp/app.app' });
    mocked.install.mockResolvedValue({ applicationIdentifier: 'dev.expo.app' });
    mocked.launch.mockResolvedValue(undefined);
    mocked.preview.mockResolvedValue({
      previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
      apiUrl: 'https://web-preview.example.test',
      previewToken: 'preview-token',
      stopAsync: previewStopAsync,
    });
    mocked.turn.mockResolvedValue(['--stun-url', 'stun:example.test']);
    mocked.selectXcode.mockResolvedValue(undefined);
    mocked.wait.mockResolvedValue(undefined);
    mocked.publish.mockResolvedValue(undefined);
    mocked.stopEgress.mockResolvedValue(undefined);
    mocked.recordings.startAsync.mockResolvedValue(undefined);
    mocked.recordings.finishAsync.mockResolvedValue([]);
    mocked.metricsRecorder.startAsync.mockResolvedValue(undefined);
    mocked.uploadRecordings.mockResolvedValue(undefined);
    mocked.collectMetrics.mockResolvedValue(undefined);
    mocked.agentDevice.mockResolvedValue({
      remoteConfig: {
        agentDeviceRemoteSessionUrl: 'https://agent-device.example.test',
        agentDeviceRemoteSessionToken: 'daemon-token',
      },
      daemonPort: 4321,
      getLastEventObservedAt: () => undefined,
      stopAsync: controllerStopAsync,
    });
    previewStopAsync.mockResolvedValue(undefined);
    controllerStopAsync.mockResolvedValue(undefined);
  });

  it('runs an iOS web preview session with an application in dependency order', async () => {
    await runDeviceRunSessionJobAsync(createContext(createJob()));

    // Xcode is selected before anything boots or polls.
    expect(callOrder(mocked.selectXcode)).toBeLessThan(callOrder(mocked.boot));
    expect(callOrder(mocked.selectXcode)).toBeLessThan(callOrder(mocked.recordings.startAsync));
    // The download does not wait for the boot; the install waits for both.
    expect(mocked.download).toHaveBeenCalledWith(
      expect.objectContaining({
        buildId: '9a2f2f1e-5d1e-4a6e-9a1f-9e2c1c6c0b11',
        extensions: ['app'],
        robotAccessToken: 'robot-token',
      })
    );
    expect(callOrder(mocked.install)).toBeGreaterThan(callOrder(mocked.boot));
    expect(callOrder(mocked.install)).toBeGreaterThan(callOrder(mocked.download));
    expect(mocked.install).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactPath: '/tmp/app.app',
        runtimePlatform: BuildRuntimePlatform.DARWIN,
      })
    );
    expect(mocked.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationIdentifier: 'dev.expo.app',
        launchArgs: ['-flag'],
        openUrl: 'exp://127.0.0.1:8081',
      })
    );
    // The preview starts after the boot, with the pre-fetched TURN args and the typed config.
    expect(callOrder(mocked.preview)).toBeGreaterThan(callOrder(mocked.boot));
    expect(mocked.preview).toHaveBeenCalledWith(
      expect.any(CustomBuildContext),
      expect.objectContaining({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        baseDomain: 'sim.example.test',
        deviceRunSessionId: 'session-id',
        turnArgs: ['--stun-url', 'stun:example.test'],
        timeoutMs: 60_000,
      })
    );
    // The launch_application task launches the app, so serve-sim gets no launch options.
    expect(mocked.preview.mock.calls[0][1]).not.toHaveProperty('launchAppIdentifier');
    // The remote session is published after the launch, then held.
    expect(callOrder(mocked.publish)).toBeGreaterThan(callOrder(mocked.launch));
    expect(mocked.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceRunSessionId: 'session-id',
        remoteConfig: {
          previewUrl: 'https://expo.dev/simulator-preview/preview-id',
          previewApiUrl: 'https://web-preview.example.test',
          previewToken: 'preview-token',
        },
      })
    );
    expect(callOrder(mocked.wait)).toBeGreaterThan(callOrder(mocked.publish));
    expect(mocked.wait).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceRunSessionId: 'session-id',
        maxDurationSeconds: 900,
        idleTimeout: undefined,
      })
    );
    // Teardown runs after the session and uploads what the pollers collected.
    expect(callOrder(previewStopAsync)).toBeGreaterThan(callOrder(mocked.wait));
    expect(mocked.uploadRecordings).toHaveBeenCalledTimes(1);
    expect(mocked.collectMetrics).toHaveBeenCalledWith(
      expect.any(CustomBuildContext),
      expect.objectContaining({ deviceRunSessionId: 'session-id' })
    );
    expect(mocked.stopEgress).toHaveBeenCalledTimes(1);
    // Every task reports its duration.
    expect(mocked.datadog.distribution).toHaveBeenCalledWith(
      'device_run_session.task_duration_ms',
      expect.any(Number),
      expect.objectContaining({
        task: 'boot_device',
        result: 'success',
        controller: 'web-preview-only',
      })
    );
    expect(mocked.datadog.distribution).toHaveBeenCalledWith(
      'device_run_session.time_to_remote_config_ms',
      expect.any(Number),
      expect.objectContaining({ device_platform: 'ios' })
    );
  });

  it('prefetches the preview package while the device boots', async () => {
    await runDeviceRunSessionJobAsync(createContext(createJob()));

    expect(mocked.spawn).toHaveBeenCalledWith(
      'npx',
      ['--yes', '--package', '@expo/serve-sim@latest', '--call', 'true'],
      expect.anything()
    );
  });

  it('prefetches with the package manager the session overrides', async () => {
    await runDeviceRunSessionJobAsync(
      createContext(createJob(), { EAS_OVERRIDE_PACKAGE_MANAGER: 'bun' })
    );

    expect(mocked.spawn).toHaveBeenCalledWith(
      'bun',
      ['add', '@expo/serve-sim@latest'],
      expect.objectContaining({ cwd: expect.stringContaining('eas-session-prefetch-') })
    );
    expect(mocked.spawn).not.toHaveBeenCalledWith('npx', expect.anything(), expect.anything());
  });

  it('keeps the device usable when the application cannot be downloaded', async () => {
    mocked.download.mockRejectedValue(new Error('404 Not Found'));

    await expect(runDeviceRunSessionJobAsync(createContext(createJob()))).resolves.toBeUndefined();

    expect(mocked.install).not.toHaveBeenCalled();
    expect(mocked.launch).not.toHaveBeenCalled();
    expect(mocked.publish).toHaveBeenCalledTimes(1);
    expect(mocked.wait).toHaveBeenCalledTimes(1);
    expect(mocked.datadog.distribution).toHaveBeenCalledWith(
      'device_run_session.task_duration_ms',
      expect.any(Number),
      expect.objectContaining({ task: 'download_build', result: 'failed' })
    );
  });

  it('fails the session when the device does not boot, and still cleans up', async () => {
    const bootError = new Error('simctl boot failed');
    mocked.boot.mockRejectedValue(bootError);

    await expect(runDeviceRunSessionJobAsync(createContext(createJob()))).rejects.toBe(bootError);

    expect(mocked.install).not.toHaveBeenCalled();
    expect(mocked.preview).not.toHaveBeenCalled();
    expect(mocked.publish).not.toHaveBeenCalled();
    expect(mocked.stopEgress).toHaveBeenCalledTimes(1);
    expect(mocked.collectMetrics).toHaveBeenCalledTimes(1);
  });

  it('merges the controller and preview into the remote config and applies the idle timeout', async () => {
    const job = createJob({
      session: {
        id: 'session-id',
        controller: DeviceRunSession.Controller.AGENT_DEVICE,
        maxDurationSeconds: 900,
        maxIdleTimeMinutes: 5,
        packageVersion: '0.9.0',
        ngrokTunnelDomain: 'sim.example.test',
      },
      application: undefined,
    });

    await runDeviceRunSessionJobAsync(createContext(job));

    expect(mocked.agentDevice).toHaveBeenCalledWith(
      expect.any(CustomBuildContext),
      expect.objectContaining({
        deviceRunSessionId: 'session-id',
        packageVersion: '0.9.0',
        ngrokTunnelDomain: 'sim.example.test',
        ngrokAuthtoken: 'ngrok-token',
      })
    );
    // Other controllers preview with the latest preview package, not their own version.
    expect(mocked.preview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ packageVersion: undefined })
    );
    // agent-device installs with Bun unless the session overrides the package manager.
    expect(mocked.spawn).toHaveBeenCalledWith(
      'bun',
      ['add', 'agent-device@0.9.0'],
      expect.objectContaining({ cwd: expect.stringContaining('eas-session-prefetch-') })
    );
    expect(mocked.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: {
          agentDeviceRemoteSessionUrl: 'https://agent-device.example.test',
          agentDeviceRemoteSessionToken: 'daemon-token',
          webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
          previewApiUrl: 'https://web-preview.example.test',
          webPreviewToken: 'preview-token',
        },
      })
    );
    expect(mocked.wait).toHaveBeenCalledWith(
      expect.objectContaining({
        idleTimeout: expect.objectContaining({ maxIdleTimeMinutes: 5 }),
      })
    );
    expect(callOrder(controllerStopAsync)).toBeGreaterThan(callOrder(mocked.wait));
  });

  it('starts local egress before the boot when requested', async () => {
    mocked.localEgress.mockResolvedValue(undefined);

    await runDeviceRunSessionJobAsync(
      createContext(createJob({ egress: DeviceRunSession.Egress.LOCAL }))
    );

    expect(mocked.localEgress).toHaveBeenCalledWith(
      expect.objectContaining({
        ngrokTunnelDomain: 'sim.example.test',
        ngrokAuthtoken: 'ngrok-token',
      })
    );
    expect(callOrder(mocked.localEgress)).toBeLessThan(callOrder(mocked.boot));
  });

  it('rejects an invalid job before starting anything', async () => {
    const job = { ...createJob(), session: undefined } as unknown as DeviceRunSession.Job;

    await expect(runDeviceRunSessionJobAsync(createContext(job))).rejects.toThrow(SystemError);

    expect(mocked.boot).not.toHaveBeenCalled();
  });

  it('refuses to run a session for another platform than the worker', async () => {
    jest
      .spyOn(CustomBuildContext.prototype, 'runtimePlatform', 'get')
      .mockReturnValue(BuildRuntimePlatform.LINUX);

    await expect(runDeviceRunSessionJobAsync(createContext(createJob()))).rejects.toThrow(
      /wrong resource class/
    );
    expect(mocked.boot).not.toHaveBeenCalled();
  });
});
