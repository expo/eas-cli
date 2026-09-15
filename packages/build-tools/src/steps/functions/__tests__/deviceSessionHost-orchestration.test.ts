import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';

import type { CustomBuildContext } from '../../../customBuildContext';
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
import { createStartAgentDeviceRemoteSessionBuildFunction } from '../startAgentDeviceRemoteSession';
import { createStartAppiumRemoteSessionBuildFunction } from '../startAppiumRemoteSession';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/turtleFetch');
jest.mock('../../../utils/AndroidEmulatorUtils');
jest.mock('../../utils/deviceSessionHost');
jest.mock('../../utils/agentDeviceEvents');
jest.mock('../../utils/appiumEvents');
jest.mock('../../utils/agentDeviceArtifacts');
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

beforeEach(() => {
  jest.clearAllMocks();
  // The daemon package is external. No installation or daemon process runs in these tests.
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
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
  jest
    .mocked(spawnDetached)
    .mockReturnValue({ pid: undefined, getOutput: () => '', stopAsync: stopTool });
  jest
    .mocked(startNgrokTunnelAsync)
    .mockResolvedValue({
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
  ['Agent Device', createStartAgentDeviceRemoteSessionBuildFunction],
] as const)('%s host ownership', (_name, createFunction) => {
  async function runAsync() {
    const fn = createFunction({} as CustomBuildContext);
    await fn.fn!(
      {
        logger: { info: jest.fn(), warn: jest.fn() },
        global: { runtimePlatform: BuildRuntimePlatform.LINUX },
      } as unknown as BuildStepContext,
      {
        inputs: {
          package_version: { value: undefined },
          max_idle_time_minutes: { value: undefined },
        },
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

  it('finalizes recording even while automation tunnel close is pending', async () => {
    let release!: () => void;
    let finished!: () => void;
    const pendingClose = new Promise<void>(resolve => {
      release = resolve;
    });
    const hostFinished = new Promise<void>(resolve => {
      finished = resolve;
    });
    stopTunnel.mockReturnValueOnce(pendingClose);
    finishHost.mockImplementationOnce(async () => {
      finished();
    });
    const running = runAsync();
    try {
      await hostFinished;
      expect(stopTunnel).toHaveBeenCalledTimes(1);
      expect(stopTool).not.toHaveBeenCalled();
    } finally {
      release();
      await running;
    }
  });

  it('still stops automation when recording finalization rejects', async () => {
    finishHost.mockRejectedValueOnce(new Error('recording cleanup failed'));
    await expect(runAsync()).rejects.toThrow('recording cleanup failed');
    expect(stopTool).toHaveBeenCalledTimes(1);
    expect(stopTunnel).toHaveBeenCalledTimes(1);
  });

  it.each(['preview', 'config', 'wait'])('finishes the host after %s fails', async phase => {
    const error = new Error(`${phase} failed`);
    if (phase === 'preview') {
      openPreview.mockRejectedValueOnce(error);
    } else if (phase === 'config') {
      jest.mocked(uploadRemoteSessionConfigAsync).mockRejectedValueOnce(error);
    } else {
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mockRejectedValueOnce(error);
    }
    await expect(runAsync()).rejects.toBe(error);
    expect(finishHost).toHaveBeenCalledTimes(1);
    expect(stopTool).toHaveBeenCalledTimes(1);
    expect(stopTunnel).toHaveBeenCalledTimes(1);
  });
});
