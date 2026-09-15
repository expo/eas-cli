import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';

import { type CustomBuildContext } from '../../../customBuildContext';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { isProcessDescendantOfAsync } from '../../../utils/processes';
import { turtleFetch } from '../../../utils/turtleFetch';
import {
  monitorLocalEgressAsync,
  readLocalEgressHandoffAsync,
  registerLocalEgressResources,
  stopLocalEgressResourcesAsync,
} from '../../utils/localEgress';
import {
  startDeviceWebPreviewWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../../utils/remoteDeviceRunSession';
import { createStartAgentDeviceRemoteSessionBuildFunction } from '../startAgentDeviceRemoteSession';
import { createStartAppiumRemoteSessionBuildFunction } from '../startAppiumRemoteSession';
import { createStartArgentRemoteSessionBuildFunction } from '../startArgentRemoteSession';
import { createStartWebPreviewRemoteSessionBuildFunction } from '../startWebPreviewRemoteSession';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/IosSimulatorUtils');
jest.mock('../../../utils/processes');
jest.mock('../../../utils/turtleFetch');
jest.mock('../../utils/agentDeviceArtifacts');
jest.mock('../../utils/argentArtifacts');
jest.mock('../../utils/agentDeviceEvents', () => ({
  startAgentDeviceEventCollectionAsync: async () => ({ stopAsync: jest.fn() }),
}));
jest.mock('../../utils/argentEvents', () => ({
  ARGENT_EVENT_LOG_FILENAME: 'events.jsonl',
  startArgentEventCollectionAsync: async () => ({ stopAsync: jest.fn() }),
}));
jest.mock('../../utils/appiumEvents', () => ({
  startAppiumEventCollectionAsync: async () => ({ stopAsync: jest.fn() }),
}));
jest.mock('../../utils/localEgress', () => ({
  ...jest.requireActual('../../utils/localEgress'),
  readLocalEgressHandoffAsync: jest.fn(),
  monitorLocalEgressAsync: jest.fn(),
}));
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  getDeviceRunSessionIdOrThrow: () => 'session-id',
  getNgrokTunnelDomainOrThrow: () => 'example.test',
  getNgrokAuthtokenOrThrow: () => 'ngrok-token',
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  ensureFfmpegInstalledOnceAsync: jest.fn(),
  spawnDetached: () => ({ pid: 123, getOutput: () => '', stopAsync: jest.fn() }),
  waitForFileAsync: async () => ({ port: 1234, token: 'controller-token' }),
  startNgrokTunnelAsync: async () => ({ url: 'https://controller.test', stopAsync: jest.fn() }),
  startDeviceWebPreviewWithTunnelAsync: jest.fn(),
  uploadRemoteSessionConfigAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
}));

const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const ctx = {} as CustomBuildContext;
const env = { DEVICE_RUN_SESSION_ID: 'session-id' };
const handoff = { url: 'https://egress.test', token: 'secret', fingerprint: 'key=', port: 8899 };
const fields = {
  egressUrl: handoff.url,
  egressToken: handoff.token,
  egressFingerprint: handoff.fingerprint,
  egressPort: handoff.port,
};
const controllers = [
  ['agent-device', createStartAgentDeviceRemoteSessionBuildFunction, 'agentDeviceRemoteSessionUrl'],
  ['Appium', createStartAppiumRemoteSessionBuildFunction, 'appiumUrl'],
  ['Argent', createStartArgentRemoteSessionBuildFunction, 'toolsUrl'],
  ['web preview', createStartWebPreviewRemoteSessionBuildFunction, 'previewUrl'],
] as const;

describe.each(controllers)('%s local egress', (_name, createFunction, controllerField) => {
  const stopPreview = jest.fn();
  const stopEgress = jest.fn();
  let lifetime: AbortSignal;
  async function run(signal?: AbortSignal): Promise<void> {
    await createFunction(ctx).fn!(
      { logger, global: { runtimePlatform: BuildRuntimePlatform.DARWIN } } as BuildStepContext,
      {
        inputs: {
          package_version: { value: undefined },
          max_idle_time_minutes: { value: undefined },
        },
        outputs: {},
        env,
        signal,
      } as never
    );
  }
  beforeEach(() => {
    jest.clearAllMocks();
    lifetime = registerLocalEgressResources(stopEgress);
    stopEgress.mockResolvedValue(undefined);
    stopPreview.mockResolvedValue(undefined);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/appium-egress-test');
    jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue(['tool-server.json'] as never);
    jest
      .spyOn(fs.promises, 'readFile')
      .mockResolvedValue(JSON.stringify({ port: 1234, pid: 124, token: 'controller-token' }));
    jest.mocked(spawn).mockResolvedValue({ stdout: '{}' } as never);
    jest.mocked(isProcessDescendantOfAsync).mockResolvedValue(true);
    jest
      .mocked(IosSimulatorUtils.getAvailableDevicesAsync)
      .mockResolvedValue([{ udid: 'sim' }] as never);
    jest.mocked(turtleFetch).mockResolvedValue({ ok: true } as never);
    jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue(handoff);
    jest.mocked(monitorLocalEgressAsync).mockResolvedValue(undefined);
    jest.mocked(startDeviceWebPreviewWithTunnelAsync).mockResolvedValue({
      previewUrl: 'https://preview.test',
      previewToken: 'preview-secret',
      stopAsync: stopPreview,
    });
    jest.mocked(uploadRemoteSessionConfigAsync).mockResolvedValue(undefined);
    jest.mocked(waitForDeviceRunSessionStoppedAsync).mockImplementation(async () => {
      expect(lifetime.aborted).toBe(false);
      expect(monitorLocalEgressAsync).toHaveBeenCalledTimes(1);
    });
  });
  afterEach(async () => {
    await stopLocalEgressResourcesAsync(logger);
    jest.restoreAllMocks();
  });

  it('reports credentials and starts monitoring before waiting, then releases resources', async () => {
    await run();
    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith({
      ctx,
      deviceRunSessionId: 'session-id',
      logger,
      remoteConfig: expect.objectContaining({
        ...fields,
        [controllerField]: expect.any(String),
        [controllerField === 'previewUrl' ? 'previewToken' : 'webPreviewToken']: 'preview-secret',
      }),
    });
    expect(monitorLocalEgressAsync).toHaveBeenCalledWith({
      port: handoff.port,
      env,
      logger,
      signal: expect.any(AbortSignal),
    });
    expect(lifetime.aborted).toBe(true);
    expect(stopEgress).toHaveBeenCalledTimes(1);
  });
  it('leaves ordinary remote config unchanged and does not monitor', async () => {
    await stopLocalEgressResourcesAsync(logger);
    stopEgress.mockClear();
    jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue(null);
    jest.mocked(waitForDeviceRunSessionStoppedAsync).mockResolvedValue(undefined);
    await run();
    const { remoteConfig } = jest.mocked(uploadRemoteSessionConfigAsync).mock.calls[0][0];
    expect(remoteConfig).toHaveProperty(controllerField);
    expect(Object.keys(remoteConfig).some(key => key.startsWith('egress'))).toBe(false);
    expect(monitorLocalEgressAsync).not.toHaveBeenCalled();
    expect(stopEgress).not.toHaveBeenCalled();
  });
  it.each(['startup', 'report', 'wait', 'teardown'])(
    'releases egress after %s fails',
    async phase => {
      const error = new Error(`${phase} failed`);
      if (phase === 'startup') {
        jest.mocked(startDeviceWebPreviewWithTunnelAsync).mockRejectedValue(error);
      } else if (phase === 'report') {
        jest.mocked(uploadRemoteSessionConfigAsync).mockRejectedValue(error);
      } else if (phase === 'wait') {
        jest.mocked(waitForDeviceRunSessionStoppedAsync).mockRejectedValue(error);
      } else {
        stopPreview.mockRejectedValue(error);
      }
      await expect(run()).rejects.toThrow(error);
      expect(lifetime.aborted).toBe(true);
      expect(stopEgress).toHaveBeenCalledTimes(1);
      expect(monitorLocalEgressAsync).toHaveBeenCalledTimes(
        phase === 'startup' || phase === 'report' ? 0 : 1
      );
    }
  );
  it('passes cancellation to the monitor and releases the lifetime', async () => {
    const abort = new AbortController();
    jest.mocked(waitForDeviceRunSessionStoppedAsync).mockImplementation(async () => abort.abort());
    await run(abort.signal);
    expect(monitorLocalEgressAsync).toHaveBeenCalledWith(
      expect.objectContaining({ signal: abort.signal })
    );
    expect(lifetime.aborted).toBe(true);
    expect(stopEgress).toHaveBeenCalledTimes(1);
  });
  it('does not report or start a monitor after cancellation', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(run(abort.signal)).rejects.toThrow();
    expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    expect(monitorLocalEgressAsync).not.toHaveBeenCalled();
    expect(stopEgress).toHaveBeenCalledTimes(1);
  });
});
