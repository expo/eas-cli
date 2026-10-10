import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../../customBuildContext';
import { pollAgentDeviceArtifactsForUploadAsync } from '../../utils/agentDeviceArtifacts';
import { startAgentDeviceEventCollectionAsync } from '../../utils/agentDeviceEvents';
import { startDeviceSessionHostAsync } from '../../utils/deviceSessionHost';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
  waitForFileAsync,
} from '../../utils/remoteDeviceRunSession';
import { createProcessOutput } from '../../utils/processOutput';
import { type StartupTasks, createStartupTasks } from '../../utils/startupTasks';
import { runAgentDeviceRemoteSessionAsync } from '../startAgentDeviceRemoteSession';

// The daemon entry path and the state directory are resolved from the home directory when
// the module loads, so point it at a temp home we can populate.
jest.mock('node:os', () => {
  const actual = jest.requireActual('node:os');
  const actualPath = jest.requireActual('node:path');
  return {
    ...actual,
    homedir: () => actualPath.join(actual.tmpdir(), 'eas-agent-device-orchestration-home'),
  };
});
jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../../sentry');
jest.mock('../../utils/agentDeviceArtifacts', () => ({
  pollAgentDeviceArtifactsForUploadAsync: jest.fn(),
}));
jest.mock('../../utils/agentDeviceEvents', () => ({
  startAgentDeviceEventCollectionAsync: jest.fn(),
}));
jest.mock('../../utils/deviceSessionHost');
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  getDeviceRunSessionIdOrThrow: jest.fn(),
  getNgrokAuthtokenOrThrow: jest.fn(),
  getNgrokTunnelDomainOrThrow: jest.fn(),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  spawnDetached: jest.fn(),
  startNgrokTunnelAsync: jest.fn(),
  uploadRemoteSessionConfigAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
  waitForFileAsync: jest.fn(),
}));

const TEST_HOME = path.join(os.tmpdir(), 'eas-agent-device-orchestration-home');
const DAEMON_ENTRY_PATH = path.join(
  TEST_HOME,
  '.bun/install/global/node_modules/agent-device/dist/src/internal/daemon.js'
);

const ctx = {} as unknown as CustomBuildContext;
const mockPreviewStopAsync = jest.fn();
const mockTunnelStopAsync = jest.fn();
const mockDaemonStopAsync = jest.fn();
const mockEventCollectionStopAsync = jest.fn();

type CaptureInputs = Parameters<typeof runAgentDeviceRemoteSessionAsync>[1]['capture'];
const NO_CAPTURE: CaptureInputs = { networkCapture: false, networkCaptureFields: [] };

/** Runs an Android session that is ready, or an iOS session with no application preparation. */
async function runAsync(
  logger: { info: jest.Mock; warn: jest.Mock; child: jest.Mock },
  runtimePlatform: BuildRuntimePlatform,
  capture: CaptureInputs = NO_CAPTURE
): Promise<void> {
  await runAgentDeviceRemoteSessionAsync(ctx, {
    env: {},
    logger: logger as never,
    runtimePlatform,
    sessionEnv: {
      deviceRunSessionId: 'device-run-session-id',
      ngrokTunnelDomain: 'tunnel.example.com',
      ngrokAuthtoken: 'ngrok-token',
    },
    packageVersion: undefined,
    maxIdleTimeMinutes: undefined,
    maxDurationSeconds: undefined,
    capture,
    tasks: createStartupTasks(logger as never),
    device:
      runtimePlatform === BuildRuntimePlatform.DARWIN
        ? { iosSimulatorUdid: 'selected-udid', application: Promise.resolve() }
        : { booted: Promise.resolve(), ready: Promise.resolve() },
  });
}

describe('runAgentDeviceRemoteSessionAsync orchestration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    jest.mocked(spawn).mockResolvedValue(undefined as never);
    jest.mocked(pollAgentDeviceArtifactsForUploadAsync).mockResolvedValue(undefined);
    jest.mocked(startAgentDeviceEventCollectionAsync).mockResolvedValue({
      stopAsync: mockEventCollectionStopAsync,
      getLastEventObservedAt: () => undefined,
    });
    jest.mocked(getDeviceRunSessionIdOrThrow).mockReturnValue('device-run-session-id');
    jest.mocked(getNgrokTunnelDomainOrThrow).mockReturnValue('tunnel.example.com');
    jest.mocked(getNgrokAuthtokenOrThrow).mockReturnValue('ngrok-token');
    jest.mocked(selectXcodeDeveloperDirectoryAsync).mockResolvedValue(undefined);
    jest.mocked(spawnDetached).mockReturnValue({
      pid: 4242,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: mockDaemonStopAsync,
    });
    jest.mocked(waitForFileAsync).mockResolvedValue({ port: 5678, token: 'daemon-token' });
    jest.mocked(startNgrokTunnelAsync).mockResolvedValue({
      url: 'https://agent-device-abc.tunnel.example.com',
      subdomainId: 'agent-device-abc',
      stopAsync: mockTunnelStopAsync,
    });
    const host = {
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.tunnel.example.com',
        closeAsync: jest.fn(),
      }),
      finishAsync: mockPreviewStopAsync,
    };
    jest.mocked(startDeviceSessionHostAsync).mockImplementation(async (_ctx, options) => {
      try {
        await options.application;
        options.signal?.throwIfAborted();
      } catch (error) {
        await mockPreviewStopAsync();
        throw error;
      }
      return host;
    });
    jest.mocked(uploadRemoteSessionConfigAsync).mockResolvedValue(undefined);
    jest.mocked(waitForDeviceRunSessionStoppedAsync).mockResolvedValue(undefined);

    await fs.promises.mkdir(path.dirname(DAEMON_ENTRY_PATH), { recursive: true });
    await fs.promises.writeFile(DAEMON_ENTRY_PATH, '');
  });

  afterEach(async () => {
    await fs.promises.rm(TEST_HOME, { recursive: true, force: true });
  });

  it('reports the preview URL and tears every resource down', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };

    await runAsync(logger, BuildRuntimePlatform.LINUX);

    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ runtimePlatform: BuildRuntimePlatform.LINUX, timeoutMs: 60_000 })
    );
    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: expect.objectContaining({
          agentDeviceRemoteSessionUrl: 'https://agent-device-abc.tunnel.example.com',
          agentDeviceRemoteSessionToken: 'daemon-token',
          webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
          previewApiUrl: 'https://web-preview.tunnel.example.com',
        }),
      })
    );
    expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
    expect(mockTunnelStopAsync).toHaveBeenCalledTimes(1);
    expect(mockEventCollectionStopAsync).toHaveBeenCalledTimes(1);
    expect(mockDaemonStopAsync).toHaveBeenCalledTimes(1);
  });

  it('redacts learned daemon credentials in arbitrary output and retained diagnostics', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
    const token = 'daemon secret/+';
    jest.mocked(waitForFileAsync).mockResolvedValue({ port: 5678, token });
    jest.mocked(startNgrokTunnelAsync).mockImplementation(async () => {
      const options = jest.mocked(spawnDetached).mock.calls[0][0];
      expect(options.secrets).toContain(token);
      const output = createProcessOutput(options.logger, options.secrets);
      output.stdout.append('unrecognized value: daemon sec');
      output.stdout.append('ret/+\n');
      output.stderr.append(`escaped value: ${encodeURIComponent(token)}\n`);
      expect(output.getOutput()).toBe(
        'unrecognized value: [REDACTED]\nescaped value: [REDACTED]\n'
      );
      return { url: 'https://daemon.test', subdomainId: 'daemon', stopAsync: mockTunnelStopAsync };
    });
    await runAsync(logger, BuildRuntimePlatform.DARWIN);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(token);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(encodeURIComponent(token));
  });

  it('hands network capture to serve-sim', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };

    await runAsync(logger, BuildRuntimePlatform.DARWIN, {
      networkCapture: true,
      networkCaptureFields: ['header'],
    });

    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ networkCapture: true, networkCaptureFields: ['header'] })
    );
  });

  it('starts the session host without waiting for the agent-device daemon', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
    const sessionHost = await jest.mocked(startDeviceSessionHostAsync).getMockImplementation()!(
      ctx,
      {} as never
    );
    let markHostStarted!: () => void;
    const hostStarted = new Promise<void>(resolve => {
      markHostStarted = resolve;
    });
    jest.mocked(startDeviceSessionHostAsync).mockImplementation(async () => {
      markHostStarted();
      return sessionHost;
    });
    // The daemon credentials only appear after the session host started. A sequential
    // startup would wait here forever.
    jest.mocked(waitForFileAsync).mockImplementation(async () => {
      await hostStarted;
      return { port: 5678, token: 'daemon-token' };
    });

    await runAsync(logger, BuildRuntimePlatform.DARWIN);

    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: expect.objectContaining({
          agentDeviceRemoteSessionUrl: 'https://agent-device-abc.tunnel.example.com',
          agentDeviceRemoteSessionToken: 'daemon-token',
          webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
        }),
      })
    );
  });

  it('stops the daemon and its tunnel when the session host fails to start', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
    jest
      .mocked(startDeviceSessionHostAsync)
      .mockRejectedValue(new Error('serve-sim did not start'));

    await expect(runAsync(logger, BuildRuntimePlatform.DARWIN)).rejects.toThrow(
      'serve-sim did not start'
    );

    expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    // The failure aborts the daemon task, which then may not start its daemon or tunnel.
    // Whatever started is stopped.
    expect(mockDaemonStopAsync).toHaveBeenCalledTimes(jest.mocked(spawnDetached).mock.calls.length);
    expect(mockTunnelStopAsync).toHaveBeenCalledTimes(
      jest.mocked(startNgrokTunnelAsync).mock.calls.length
    );
  });

  it('stops the session host and the daemon when the daemon credentials never appear', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
    jest.mocked(waitForFileAsync).mockRejectedValue(new Error('no daemon credentials'));

    await expect(runAsync(logger, BuildRuntimePlatform.DARWIN)).rejects.toThrow(
      'no daemon credentials'
    );

    expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
    expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
    expect(mockDaemonStopAsync).toHaveBeenCalledTimes(1);
  });

  describe('runAgentDeviceRemoteSessionAsync with a device that is still starting', () => {
    function deferred<T = void>(): {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (e: Error) => void;
    } {
      let resolve!: (value: T) => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      promise.catch(() => {});
      return { promise, resolve, reject };
    }

    type Device = Parameters<typeof runAgentDeviceRemoteSessionAsync>[1]['device'];
    function startSession(
      device: Device | ((tasks: StartupTasks) => Device),
      signal?: AbortSignal
    ) {
      const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        child: jest.fn().mockReturnThis(),
      } as never;
      const tasks = createStartupTasks(logger, signal);
      const sessionDevice = typeof device === 'function' ? device(tasks) : device;
      return runAgentDeviceRemoteSessionAsync(ctx, {
        env: {},
        logger,
        signal,
        runtimePlatform:
          'iosSimulatorUdid' in sessionDevice
            ? BuildRuntimePlatform.DARWIN
            : BuildRuntimePlatform.LINUX,
        sessionEnv: {
          deviceRunSessionId: 'device-run-session-id',
          ngrokTunnelDomain: 'tunnel.example.com',
          ngrokAuthtoken: 'ngrok-token',
        },
        packageVersion: undefined,
        maxIdleTimeMinutes: undefined,
        maxDurationSeconds: undefined,
        capture: NO_CAPTURE,
        tasks,
        device: sessionDevice,
      });
    }

    async function flushAsync(): Promise<void> {
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    it('aborts parallel startup before host failure cleanup finishes', async () => {
      const failure = new Error('guard refused startup');
      const cleanup = deferred();
      const notified = deferred();
      let startupTasks!: StartupTasks;
      jest.mocked(startDeviceSessionHostAsync).mockImplementation(async (_ctx, options) => {
        options.onStartupError?.(failure);
        notified.resolve();
        await cleanup.promise;
        throw failure;
      });
      const session = startSession(tasks => {
        startupTasks = tasks;
        return { iosSimulatorUdid: 'selected-udid' };
      });
      const rejected = expect(session).rejects.toBe(failure);
      await notified.promise;
      expect(startupTasks.signal.aborted).toBe(true);
      expect(startupTasks.signal.reason).toBe(failure);
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
      cleanup.resolve();
      await rejected;
    });

    it('starts the daemon during the Android boot and the session host after it', async () => {
      const booted = deferred();
      const session = startSession({ booted: booted.promise, ready: booted.promise });
      await flushAsync();

      expect(spawnDetached).toHaveBeenCalledTimes(1);
      expect(startNgrokTunnelAsync).toHaveBeenCalledTimes(1);
      expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();

      booted.resolve();
      await session;
      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
      expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          runtimePlatform: BuildRuntimePlatform.LINUX,
          timeoutMs: 60_000,
          iosSimulatorUdid: undefined,
        })
      );
      expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledTimes(1);
    });

    it('preserves a failed download when aborting daemon installation rejects first', async () => {
      const failure = new Error('download failed: build not found');
      const installStarted = deferred();
      jest.mocked(spawn).mockImplementation((async (_command, _args, options) => {
        return await new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            'abort',
            () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true }
          );
          installStarted.resolve();
        });
      }) as typeof spawn);
      jest.mocked(startDeviceSessionHostAsync).mockImplementation(async (_ctx, { signal }) => {
        return await new Promise((_resolve, reject) => {
          signal!.addEventListener(
            'abort',
            () => {
              setTimeout(() => reject(signal!.reason), 20);
            },
            { once: true }
          );
        });
      });
      const applicationReady = Promise.resolve();
      const session = startSession(tasks => {
        void tasks.run('build download', async () => {
          await installStarted.promise;
          throw failure;
        });
        return { iosSimulatorUdid: 'selected-udid', application: applicationReady };
      });
      await expect(session).rejects.toBe(failure);
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    });

    it('boots the host during download and releases startup only after preparation', async () => {
      const hostReady = deferred();
      const application = deferred<{
        installAppPath: string;
        launchAppIdentifier: string;
        launchArgs: string[];
        openUrl: string;
      }>();
      const host = await jest.mocked(startDeviceSessionHostAsync).getMockImplementation()!(
        ctx,
        {} as never
      );
      const release = jest.fn();
      jest
        .mocked(startDeviceSessionHostAsync)
        .mockClear()
        .mockImplementation(async (_ctx, options) => {
          release(await options.application);
          await hostReady.promise;
          return host;
        });
      const applicationReady = application.promise;
      const session = startSession({
        iosSimulatorUdid: 'selected-udid',
        application: applicationReady,
      });
      await flushAsync();
      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
      const startup = {
        installAppPath: '/tmp/App.app',
        launchAppIdentifier: 'dev.example.app',
        launchArgs: ['--flag'],
        openUrl: 'example://screen',
      };
      application.resolve(startup);
      await flushAsync();
      expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          application: applicationReady,
          iosSimulatorUdid: 'selected-udid',
          timeoutMs: 60_000,
          signal: expect.any(AbortSignal),
        })
      );
      expect(release).toHaveBeenCalledWith(startup);
      expect(host.openPreviewAsync).not.toHaveBeenCalled();
      hostReady.resolve();
      await session;
      expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledTimes(1);
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
    });

    it('passes the guard boot environment with the startup installation and launch', async () => {
      const startup = {
        installAppPath: '/tmp/App.app',
        launchAppIdentifier: 'dev.example.app',
        launchArgs: ['--flag'],
        openUrl: 'example://screen',
      };
      const bootEnv = {
        SERVE_SIM_ADDITIONAL_DYLIBS: '/w/bin/egress-guard.dylib',
        SIMCTL_CHILD_EAS_EGRESS_GUARD_MODE: 'block',
        SIMCTL_CHILD_EAS_EGRESS_GUARD_LOG: '/tmp/egress-guard.log',
        SIMCTL_CHILD_HTTP_PROXY: 'http://127.0.0.1:8899',
      };
      await startSession({
        iosSimulatorUdid: 'guarded-udid',
        bootEnv,
        application: Promise.resolve(startup),
      });
      expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          application: expect.any(Promise),
          bootEnv,
          iosSimulatorUdid: 'guarded-udid',
        })
      );
      const hostOptions = jest.mocked(startDeviceSessionHostAsync).mock.calls[0][1];
      expect(hostOptions.bootEnv).toBe(bootEnv);
      expect(hostOptions.bootEnv).not.toHaveProperty('DYLD_INSERT_LIBRARIES');
      expect(hostOptions.bootEnv).not.toHaveProperty('SIMCTL_CHILD_DYLD_INSERT_LIBRARIES');
    });

    it('cleans up a host returned after cancellation without configuring the device', async () => {
      const hostReady = deferred();
      const controller = new AbortController();
      const host = await jest.mocked(startDeviceSessionHostAsync).getMockImplementation()!(
        ctx,
        {} as never
      );
      jest.mocked(startDeviceSessionHostAsync).mockImplementation(async () => {
        await hostReady.promise;
        return host;
      });
      const applicationReady = Promise.resolve();
      const session = startSession(
        { iosSimulatorUdid: 'selected-udid', application: applicationReady },
        controller.signal
      );
      const failure = expect(session).rejects.toThrow('cancelled');
      await flushAsync();
      controller.abort(new Error('cancelled'));
      hostReady.resolve();

      await failure;
      expect(host.openPreviewAsync).not.toHaveBeenCalled();
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
      expect(mockDaemonStopAsync).toHaveBeenCalledTimes(1);
      expect(mockTunnelStopAsync).toHaveBeenCalledTimes(1);
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    });

    it('drains in-flight application preparation and stops the waiting host after cancellation', async () => {
      const controller = new AbortController();
      const appReady = deferred();
      const session = startSession(
        { iosSimulatorUdid: 'selected-udid', application: appReady.promise },
        controller.signal
      );
      const failure = expect(session).rejects.toThrow('cancelled');
      await flushAsync();
      controller.abort(new Error('cancelled'));
      await flushAsync();
      expect(mockPreviewStopAsync).not.toHaveBeenCalled();

      appReady.resolve();
      await failure;
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    });

    it('does not report readiness when cancellation arrives during preview startup', async () => {
      const controller = new AbortController();
      const previewReady = deferred();
      const host = await jest.mocked(startDeviceSessionHostAsync).getMockImplementation()!(
        ctx,
        {} as never
      );
      const preview = await host.openPreviewAsync({ baseDomain: 'tunnel.example.com' });
      jest.mocked(host.openPreviewAsync).mockImplementation(async () => {
        await previewReady.promise;
        return preview;
      });
      const session = startSession(
        { iosSimulatorUdid: 'selected-udid', application: Promise.resolve() },
        controller.signal
      );
      const failure = expect(session).rejects.toThrow('cancelled');
      await flushAsync();
      controller.abort(new Error('cancelled'));
      previewReady.resolve();

      await failure;
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    });

    it('does not start resources for an already cancelled session', async () => {
      const controller = new AbortController();
      controller.abort(new Error('cancelled'));
      const applicationReady = Promise.resolve();

      await expect(
        startSession(
          { iosSimulatorUdid: 'selected-udid', application: applicationReady },
          controller.signal
        )
      ).rejects.toThrow('cancelled');
      expect(spawn).not.toHaveBeenCalled();
      expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
    });

    it('starts the Android host before application readiness and waits before reporting ready', async () => {
      const ready = deferred();
      const session = startSession({ booted: Promise.resolve(), ready: ready.promise });
      await flushAsync();

      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();

      ready.resolve();
      await session;
      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
      expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledTimes(1);
    });

    it('stops waiting for the Android boot when the daemon fails', async () => {
      jest.mocked(waitForFileAsync).mockRejectedValue(new Error('no daemon credentials'));
      const neverBooted = new Promise<void>(() => {});

      // In the combined step, `ready` stops waiting for the boot on an abort, like this.
      await expect(
        startSession(tasks => ({ booted: neverBooted, ready: tasks.untilAborted(neverBooted) }))
      ).rejects.toThrow('no daemon credentials');

      expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
      expect(mockDaemonStopAsync).toHaveBeenCalledTimes(1);
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    });

    it('cancels daemon installation and stops the Android host when the download fails', async () => {
      jest.mocked(spawn).mockImplementation(((
        command: string,
        args: string[],
        options?: { signal?: AbortSignal }
      ) =>
        command === 'bun' && args[0] === 'add'
          ? new Promise((_resolve, reject) => {
              options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason));
            })
          : Promise.resolve(undefined)) as never);
      const ready = deferred();
      const session = startSession({ booted: Promise.resolve(), ready: ready.promise });
      await flushAsync();
      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);

      ready.reject(new Error('download failed'));

      await expect(session).rejects.toThrow('download failed');
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
      expect(spawnDetached).not.toHaveBeenCalled();
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    });

    it('stops the Android host, daemon and tunnel when the download fails', async () => {
      const ready = deferred();
      const session = startSession({ booted: Promise.resolve(), ready: ready.promise });
      await flushAsync();
      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
      ready.reject(new Error('download failed'));

      await expect(session).rejects.toThrow('download failed');
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
      expect(mockDaemonStopAsync).toHaveBeenCalledTimes(1);
      expect(mockTunnelStopAsync).toHaveBeenCalledTimes(1);
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
    });
  });
});
