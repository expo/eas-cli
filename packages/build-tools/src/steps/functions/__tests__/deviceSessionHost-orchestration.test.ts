import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';

import type { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { AndroidEmulatorUtils } from '../../../utils/AndroidEmulatorUtils';
import { turtleFetch } from '../../../utils/turtleFetch';
import { startAgentDeviceEventCollectionAsync } from '../../utils/agentDeviceEvents';
import { startAppiumEventCollectionAsync } from '../../utils/appiumEvents';
import { startDeviceSessionHostAsync } from '../../utils/deviceSessionHost';
import {
  spawnDetached,
  startNgrokTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
  waitForFileAsync,
} from '../../utils/remoteDeviceRunSession';
import { createStartAgentDeviceSessionBuildFunction } from '../startAgentDeviceSession';
import { createStartAppiumRemoteSessionBuildFunction } from '../startAppiumRemoteSession';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../sentry');
jest.mock('../../../utils/turtleFetch');
jest.mock('../../../utils/AndroidEmulatorUtils');
jest.mock('../../utils/deviceSessionHost');
jest.mock('../../utils/agentDeviceEvents');
jest.mock('../../utils/appiumEvents');
jest.mock('../../utils/agentDeviceArtifacts');
// The agent-device session step boots the emulator itself; this test covers the session host.
jest.mock('../startAndroidEmulator', () => ({
  startAndroidEmulatorAsync: jest.fn().mockResolvedValue({
    serialId: 'emulator-5554',
    emulatorPromise: Promise.resolve(),
    shouldAdjustAnimationScale: true,
  }),
}));
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  spawnDetached: jest.fn(),
  startNgrokTunnelAsync: jest.fn(),
  uploadRemoteSessionConfigAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
  waitForFileAsync: jest.fn(),
}));

const finishHost = jest.fn();
const closePreview = jest.fn();
const stopTool = jest.fn();
const stopTunnel = jest.fn();
const stopEvents = jest.fn();
const openPreview = jest.fn();
const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };

beforeEach(() => {
  jest.clearAllMocks();
  // The daemon package is external. No installation or daemon process runs in these tests.
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  // Only the emulator logcat folder: the Appium step writes into its own temp folder.
  const mkdtemp = fs.promises.mkdtemp.bind(fs.promises);
  jest
    .spyOn(fs.promises, 'mkdtemp')
    .mockImplementation(async prefix =>
      String(prefix).includes('eas-android-emulator-logcat-')
        ? '/tmp/eas-android-emulator-logcat-test'
        : mkdtemp(prefix)
    );
  jest.mocked(spawn).mockResolvedValue({ stdout: '{}' } as never);
  jest
    .mocked(AndroidEmulatorUtils.getAttachedDevicesAsync)
    .mockResolvedValue([{ serialId: 'emulator-5554', state: 'device' } as never]);
  jest.mocked(turtleFetch).mockResolvedValue({ ok: true } as never);
  jest.mocked(waitForFileAsync).mockResolvedValue({ port: 4567, token: 'daemon-token' });
  for (const stop of [finishHost, closePreview, stopTool, stopTunnel, stopEvents]) {
    stop.mockResolvedValue(undefined);
  }
  openPreview.mockResolvedValue({
    previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
    apiUrl: 'https://preview.example.test',
    closeAsync: closePreview,
  });
  jest
    .mocked(startDeviceSessionHostAsync)
    .mockResolvedValue({ openPreviewAsync: openPreview, finishAsync: finishHost });
  jest.mocked(spawnDetached).mockReturnValue({
    pid: undefined,
    getOutput: () => '',
    getExitError: () => undefined,
    stopAsync: stopTool,
  });
  jest.mocked(startNgrokTunnelAsync).mockResolvedValue({
    url: 'https://tool.example.test',
    subdomainId: 'tool-id',
    stopAsync: stopTunnel,
  });
  const events = { stopAsync: stopEvents, getLastEventObservedAt: () => undefined };
  jest.mocked(startAgentDeviceEventCollectionAsync).mockResolvedValue(events);
  jest.mocked(startAppiumEventCollectionAsync).mockResolvedValue(events);
  jest.mocked(uploadRemoteSessionConfigAsync).mockResolvedValue(undefined);
  jest.mocked(waitForDeviceRunSessionStoppedAsync).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ['Appium', createStartAppiumRemoteSessionBuildFunction],
  ['Agent Device', createStartAgentDeviceSessionBuildFunction],
] as const)('%s host ownership', (name, createFunction) => {
  async function runAsync() {
    const fn = createFunction({} as CustomBuildContext);
    await fn.fn!(
      {
        logger,
        global: { runtimePlatform: BuildRuntimePlatform.LINUX },
      } as unknown as BuildStepContext,
      {
        // Inputs a step does not get default to undefined, like in a real step call.
        inputs: new Proxy({} as Record<string, { value: unknown }>, {
          get: (target, id: string) => target[id] ?? { value: undefined },
        }),
        outputs: {},
        env: {
          DEVICE_RUN_SESSION_ID: 'session-id',
          EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN: 'example.test',
          NGROK_AUTHTOKEN: 'token',
        },
      } as never
    );
  }

  it('holds the host until session completion', async () => {
    await runAsync();
    expect(openPreview).toHaveBeenCalledWith({ baseDomain: 'example.test' });
    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: expect.objectContaining({
          webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
          previewApiUrl: 'https://preview.example.test',
        }),
      })
    );
    expect(finishHost).toHaveBeenCalledTimes(1);
    expect(closePreview).not.toHaveBeenCalled();
    expect(finishHost.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mock.invocationCallOrder[0]
    );
    expect(stopTool).toHaveBeenCalledTimes(1);
    expect(stopEvents).toHaveBeenCalledTimes(1);
    expect(stopTunnel).toHaveBeenCalledTimes(1);
  });

  it('stops automation while recording finalization or upload is pending', async () => {
    let release!: () => void;
    let stopped!: () => void;
    const pendingFinish = new Promise<void>(resolve => {
      release = resolve;
    });
    const toolStopped = new Promise<void>(resolve => {
      stopped = resolve;
    });
    finishHost.mockReturnValueOnce(pendingFinish);
    stopTool.mockImplementationOnce(async () => {
      stopped();
    });
    let completed = false;
    const running = runAsync().then(() => {
      completed = true;
    });
    try {
      await toolStopped;
      expect(stopTunnel).toHaveBeenCalledTimes(1);
      expect(finishHost).toHaveBeenCalledTimes(1);
      expect(completed).toBe(false);
    } finally {
      release();
      await running;
    }
  });

  it('finalizes recording and stops automation while the tunnel close is pending', async () => {
    let release!: () => void;
    let finished!: () => void;
    const pendingClose = new Promise<void>(resolve => {
      release = resolve;
    });
    const hostFinished = new Promise<void>(resolve => {
      finished = resolve;
    });
    const toolStopped = new Promise<void>(resolve => {
      stopTool.mockImplementationOnce(async () => resolve());
    });
    stopTunnel.mockReturnValueOnce(pendingClose);
    finishHost.mockImplementationOnce(async () => {
      finished();
    });
    const running = runAsync();
    try {
      // Both settle while the tunnel close is still held open.
      await Promise.all([hostFinished, toolStopped]);
      expect(stopTunnel).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await running;
    }
  });

  it('still stops the automation process when event collection stop rejects', async () => {
    stopEvents.mockRejectedValueOnce(new Error('collector failed'));
    // Agent Device wraps its collector stop in a catch-all helper; Appium does not.
    const outcome = await runAsync().then(
      () => 'resolved',
      (err: Error) => err.message
    );
    expect(outcome).toBe(name === 'Appium' ? 'collector failed' : 'resolved');
    expect(stopTool).toHaveBeenCalledTimes(1);
    expect(stopTunnel).toHaveBeenCalledTimes(1);
    expect(finishHost).toHaveBeenCalledTimes(1);
  });

  it('still stops automation when recording finalization rejects', async () => {
    finishHost.mockRejectedValueOnce(new Error('recording cleanup failed'));
    await expect(runAsync()).rejects.toThrow('recording cleanup failed');
    expect(stopTool).toHaveBeenCalledTimes(1);
    expect(stopTunnel).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it.each(['preview', 'config', 'wait'])('finishes the host after %s fails', async phase => {
    const error = new Error(`${phase} failed`);
    // A teardown failure must not replace the error that ended the session.
    finishHost.mockRejectedValueOnce(new Error('recording cleanup failed'));
    if (phase === 'preview') {
      openPreview.mockRejectedValueOnce(error);
    } else if (phase === 'config') {
      jest.mocked(uploadRemoteSessionConfigAsync).mockRejectedValueOnce(error);
    } else {
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mockRejectedValueOnce(error);
    }
    await expect(runAsync()).rejects.toBe(error);
    expect(finishHost).toHaveBeenCalledTimes(1);
    // An agent-device preview failure aborts the daemon task, which then may not start its
    // daemon or tunnel. Everything that started must be stopped.
    const abortsDaemonTask = name === 'Agent Device' && phase === 'preview';
    expect(stopTool).toHaveBeenCalledTimes(
      abortsDaemonTask ? jest.mocked(spawnDetached).mock.calls.length : 1
    );
    expect(stopTunnel).toHaveBeenCalledTimes(
      abortsDaemonTask ? jest.mocked(startNgrokTunnelAsync).mock.calls.length : 1
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'recording cleanup failed' }) },
      'Could not stop the session host during remote session teardown.'
    );
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not stop the session host after the remote session failed',
      expect.objectContaining({ message: 'recording cleanup failed' }),
      { level: 'warning' }
    );
  });
});

describe('Appium ffmpeg setup', () => {
  async function runAppiumAsync(): Promise<void> {
    const fn = createStartAppiumRemoteSessionBuildFunction({} as CustomBuildContext);
    await fn.fn!(
      {
        logger,
        global: { runtimePlatform: BuildRuntimePlatform.LINUX },
      } as unknown as BuildStepContext,
      {
        inputs: new Proxy({} as Record<string, { value: unknown }>, {
          get: (target, id: string) => target[id] ?? { value: undefined },
        }),
        outputs: {},
        env: {
          DEVICE_RUN_SESSION_ID: 'session-id',
          EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN: 'example.test',
          NGROK_AUTHTOKEN: 'token',
        },
      } as never
    );
  }

  function holdFfmpegInstall({ appiumError }: { appiumError?: Error } = {}) {
    let finish!: (outcome: 'installed' | 'failed') => void;
    const install = new Promise((resolve, reject) => {
      finish = outcome =>
        outcome === 'installed' ? resolve({}) : reject(new Error('apt-get failed'));
    });
    jest.mocked(spawn).mockImplementation(((command: string, args: string[]) => {
      if (command === 'ffmpeg') {
        return Promise.reject(new Error('ffmpeg missing'));
      }
      if (args.includes('install') && args.includes('ffmpeg')) {
        return install;
      }
      return command === 'npm' && appiumError
        ? Promise.reject(appiumError)
        : Promise.resolve({ stdout: '{}' });
    }) as never);
    return finish;
  }

  it.each(['installed', 'failed'] as const)(
    'starts Appium after the ffmpeg install settles (%s)',
    async outcome => {
      const finishFfmpegInstall = holdFfmpegInstall();

      const run = runAppiumAsync();
      await new Promise(resolve => setImmediate(resolve));
      expect(spawnDetached).not.toHaveBeenCalled();

      finishFfmpegInstall(outcome);
      await run;
      expect(spawnDetached).toHaveBeenCalledTimes(1);
    }
  );

  it('waits for the ffmpeg install before failing on an Appium install error', async () => {
    const appiumError = new Error('npm failed');
    const finishFfmpegInstall = holdFfmpegInstall({ appiumError });

    let settled = false;
    const run = runAppiumAsync().finally(() => {
      settled = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);

    finishFfmpegInstall('installed');
    await expect(run).rejects.toBe(appiumError);
  });
});
