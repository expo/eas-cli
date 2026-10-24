import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';

import { type CustomBuildContext } from '../../../customBuildContext';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { AndroidEmulatorUtils } from '../../../utils/AndroidEmulatorUtils';
import { killProcessGroup } from '../../../utils/processes';
import { turtleFetch } from '../../../utils/turtleFetch';
import { startAppiumEventCollectionAsync } from '../../utils/appiumEvents';
import { startDeviceSessionHostAsync } from '../../utils/deviceSessionHost';
import { resolveIosSessionStartupAsync } from '../../utils/iosSimulatorSession';
import { readLocalEgressHandoffAsync } from '../../utils/localEgress';
import { resolveLocalEgressServeSimBootEnvironmentAsync } from '../../utils/localEgressGuard';
import { uploadRemoteSessionConfigWithLocalEgressAsync } from '../../utils/localEgressSession';
import {
  WarmSessionAdoptionError,
  startWarmDeviceSessionHostAsync,
} from '../../utils/warmDeviceSessionHost';
import {
  type WarmIosSession,
  stopWarmIosSessionAsync,
  tryClaimWarmIosSessionAsync,
} from '../../utils/warmIosSession';
import { preparePreinstalledWdaAsync } from '../../utils/preinstalledWda';
import {
  ensureFfmpegInstalledOnceAsync,
  fetchWebPreviewTurnArgsAsync,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../../utils/remoteDeviceRunSession';
import { createStartWarmAppiumRemoteSessionBuildFunction } from '../startAppiumRemoteSession';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/processes', () => ({
  ...jest.requireActual('../../../utils/processes'),
  killProcessGroup: jest.fn(),
}));
jest.mock('../../../utils/AndroidEmulatorUtils', () => ({
  AndroidEmulatorUtils: { getAttachedDevicesAsync: jest.fn() },
}));
jest.mock('../../../utils/IosSimulatorUtils', () => ({
  IosSimulatorUtils: { getDeviceAsync: jest.fn(), getAvailableDevicesAsync: jest.fn() },
}));
jest.mock('../../../utils/turtleFetch');
jest.mock('../../utils/appiumEvents');
jest.mock('../../utils/deviceSessionHost');
jest.mock('../../utils/iosSimulatorSession');
jest.mock('../../utils/localEgress');
jest.mock('../../utils/localEgressGuard');
jest.mock('../../utils/localEgressSession', () => ({
  ...jest.requireActual('../../utils/localEgressSession'),
  uploadRemoteSessionConfigWithLocalEgressAsync: jest.fn(),
}));
jest.mock('../../utils/warmIosSession');
jest.mock('../../utils/warmDeviceSessionHost', () => ({
  ...jest.requireActual('../../utils/warmDeviceSessionHost'),
  startWarmDeviceSessionHostAsync: jest.fn(),
}));
jest.mock('../../utils/preinstalledWda');
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  ensureFfmpegInstalledOnceAsync: jest.fn(),
  fetchWebPreviewTurnArgsAsync: jest.fn(),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  spawnDetached: jest.fn(),
  startNgrokTunnelAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
}));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(predicate()).toBe(true);
}
const ctx = {} as CustomBuildContext;
const udid = '592047E9-7027-4394-8213-8924EFCD53F6';
const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
const stopWarm = jest.fn();
const stopAppium = jest.fn();
const stopEvents = jest.fn();
const stopTunnel = jest.fn();
const host = {
  openPreviewAsync: jest.fn(),
  getLastPreviewActivityAt: jest.fn(),
  finishAsync: jest.fn(),
};
let warm: WarmIosSession;

function run(
  inputValues: Record<string, unknown> = {},
  env: Record<string, string> = {},
  signal?: AbortSignal,
  runtimePlatform = BuildRuntimePlatform.DARWIN
): Promise<unknown> {
  const fn = createStartWarmAppiumRemoteSessionBuildFunction(ctx);
  const task = Promise.resolve(
    fn.fn!(
      { logger, global: { runtimePlatform } } as unknown as BuildStepContext,
      {
        inputs: Object.fromEntries(
          Object.entries({
            package_version: '3.2.0',
            max_idle_time_minutes: 5,
            ...inputValues,
          }).map(([name, value]) => [name, { value }])
        ),
        outputs: {},
        signal,
        env: {
          DEVICE_RUN_SESSION_ID: 'job',
          NGROK_AUTHTOKEN: 'ngrok-secret',
          EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN: 'tunnel.example',
          EAS_USE_WARM_SIMULATOR: '1',
          ...env,
        },
      } as never
    )
  );
  void task.catch(() => {});
  return task;
}
beforeEach(() => {
  jest.clearAllMocks();
  stopWarm.mockReset().mockResolvedValue(undefined);
  stopAppium.mockReset().mockResolvedValue(undefined);
  stopEvents.mockReset().mockResolvedValue(undefined);
  stopTunnel.mockReset().mockResolvedValue(undefined);
  host.finishAsync.mockReset().mockResolvedValue(undefined);
  host.openPreviewAsync.mockReset().mockResolvedValue({
    previewPageUrl: 'https://preview.example',
    apiUrl: 'https://api.example',
    previewToken: 'serve-token',
  });
  warm = {
    device: { udid, name: 'iPhone 17' },
    serveSim: { pid: 10, port: 3200, token: 'serve-token' },
    agentDeviceStateDir: '/warm/agent',
    argentEventLogPath: '/warm/argent-events',
    process: {
      pid: undefined,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopWarm,
    },
  };
  jest.mocked(tryClaimWarmIosSessionAsync).mockReset().mockResolvedValue(warm);
  jest.mocked(stopWarmIosSessionAsync).mockReset().mockResolvedValue(undefined);
  jest.mocked(startWarmDeviceSessionHostAsync).mockReset().mockResolvedValue(host);
  jest.mocked(startDeviceSessionHostAsync).mockReset().mockResolvedValue(host);
  jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue(null);
  jest.mocked(resolveLocalEgressServeSimBootEnvironmentAsync).mockResolvedValue(null);
  jest
    .mocked(resolveIosSessionStartupAsync)
    .mockReset()
    .mockResolvedValue({
      launch: {
        launchAppIdentifier: 'dev.fixture',
        launchArgs: ['--test'],
        openUrl: 'fixture://route',
      },
      iosStartup: { iosSimulatorUdid: udid, installAppPath: '/job/Fixture.app' },
    });
  jest.mocked(fetchWebPreviewTurnArgsAsync).mockResolvedValue([]);
  jest.mocked(selectXcodeDeveloperDirectoryAsync).mockResolvedValue(undefined);
  jest.mocked(ensureFfmpegInstalledOnceAsync).mockResolvedValue(undefined);
  jest
    .mocked(AndroidEmulatorUtils.getAttachedDevicesAsync)
    .mockResolvedValue([{ serialId: 'emulator-5554', state: 'device' } as never]);
  jest
    .mocked(IosSimulatorUtils.getDeviceAsync)
    .mockResolvedValue({ udid, runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4' } as never);
  jest
    .mocked(spawn)
    .mockReset()
    .mockImplementation(
      (_command, args) =>
        Object.assign(Promise.resolve({ stdout: args.includes('--json') ? '{}' : '' }), {
          child: { pid: 987654, kill: jest.fn() },
        }) as never
    );
  jest.mocked(preparePreinstalledWdaAsync).mockReset().mockResolvedValue({
    'appium:usePreinstalledWDA': true,
    'appium:prebuiltWDAPath': '/job/WDA.app',
  });
  jest.mocked(spawnDetached).mockReturnValue({
    pid: undefined,
    getOutput: () => '',
    getExitError: () => undefined,
    stopAsync: stopAppium,
  });
  jest
    .mocked(turtleFetch)
    .mockReset()
    .mockResolvedValue({ ok: true } as never);
  jest
    .mocked(startAppiumEventCollectionAsync)
    .mockResolvedValue({ stopAsync: stopEvents, getLastEventObservedAt: () => undefined });
  jest.mocked(startNgrokTunnelAsync).mockResolvedValue({
    url: 'https://appium.example',
    subdomainId: 'job',
    stopAsync: stopTunnel,
  });
  jest.mocked(uploadRemoteSessionConfigWithLocalEgressAsync).mockResolvedValue(undefined);
  jest.mocked(waitForDeviceRunSessionStoppedAsync).mockReset().mockResolvedValue(undefined);
});

it('claims before resolving the actual device, adopts before Appium setup, and publishes bound capabilities', async () => {
  const adoption = deferred<typeof host>();
  jest.mocked(startWarmDeviceSessionHostAsync).mockReturnValueOnce(adoption.promise);
  const running = run({
    device_identifier: 'requested iPhone',
    network_capture: true,
    network_capture_fields: ['header'],
  });
  try {
    await until(() => jest.mocked(startWarmDeviceSessionHostAsync).mock.calls.length > 0);
    expect(tryClaimWarmIosSessionAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: 'appium',
        requestedDevice: 'requested iPhone',
      })
    );
    expect(
      jest.mocked(tryClaimWarmIosSessionAsync).mock.calls[0][0].packageVersion
    ).toBeUndefined();
    expect(resolveIosSessionStartupAsync).toHaveBeenCalledWith(
      expect.objectContaining({ deviceIdentifier: udid })
    );
    expect(startWarmDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        iosSimulatorUdid: udid,
        installAppPath: '/job/Fixture.app',
        launchAppIdentifier: 'dev.fixture',
        launchArgs: ['--test'],
        openUrl: 'fixture://route',
        networkCapture: true,
        networkCaptureFields: ['header'],
      }),
      warm,
      expect.anything()
    );
    expect(IosSimulatorUtils.getAvailableDevicesAsync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(preparePreinstalledWdaAsync).not.toHaveBeenCalled();
    expect(uploadRemoteSessionConfigWithLocalEgressAsync).not.toHaveBeenCalled();
    adoption.resolve(host);
    await running;
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
    expect(ensureFfmpegInstalledOnceAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: expect.objectContaining({ EAS_USE_WARM_SIMULATOR: '1' }),
      })
    );
    expect(jest.mocked(spawn).mock.calls[0][1]).toContain('appium@3.2.0');
    expect(preparePreinstalledWdaAsync).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4' })
    );
    expect(uploadRemoteSessionConfigWithLocalEgressAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: expect.objectContaining({
          appiumUrl: 'https://appium.example',
          capabilities: {
            platformName: 'iOS',
            'appium:automationName': 'XCUITest',
            'appium:udid': udid,
          },
          webPreviewToken: 'serve-token',
        }),
      })
    );
    expect(stopAppium.mock.invocationCallOrder[0]).toBeLessThan(
      host.finishAsync.mock.invocationCallOrder[0]
    );
    expect(host.finishAsync.mock.invocationCallOrder[0]).toBeLessThan(
      stopWarm.mock.invocationCallOrder[0]
    );
  } finally {
    adoption.resolve(host);
    await running;
  }
});

it('uses the ordinary path on an unavailable candidate', async () => {
  jest.mocked(tryClaimWarmIosSessionAsync).mockResolvedValueOnce(undefined);
  await run();
  expect(startWarmDeviceSessionHostAsync).not.toHaveBeenCalled();
  expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
});

it.each(['flag', 'Android', 'local egress'])('keeps %s on the existing cold path', async reason => {
  if (reason === 'local egress') {
    jest.mocked(readLocalEgressHandoffAsync).mockResolvedValueOnce({ port: 1234 } as never);
  }
  if (reason === 'Android') {
    jest.mocked(resolveIosSessionStartupAsync).mockResolvedValueOnce({ launch: {} });
    jest.mocked(preparePreinstalledWdaAsync).mockResolvedValueOnce({});
  }
  await run(
    {},
    reason === 'flag' ? { EAS_USE_WARM_SIMULATOR: '0' } : {},
    undefined,
    reason === 'Android' ? BuildRuntimePlatform.LINUX : BuildRuntimePlatform.DARWIN
  );
  expect(tryClaimWarmIosSessionAsync).not.toHaveBeenCalled();
  expect(stopWarmIosSessionAsync).toHaveBeenCalledTimes(1);
  expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
});

it('waits for positive controller stop before cold fallback on a private-adoption failure', async () => {
  const stopped = deferred();
  stopWarm.mockReturnValueOnce(stopped.promise);
  jest
    .mocked(startWarmDeviceSessionHostAsync)
    .mockRejectedValueOnce(new WarmSessionAdoptionError());
  const running = run();
  try {
    await until(() => stopWarm.mock.calls.length > 0);
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    stopped.resolve();
    await running;
    expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
  } finally {
    stopped.resolve();
    await running;
  }
});

it('propagates failed stop instead of retrying after private-adoption failure', async () => {
  const error = new Error('controller stop failed');
  stopWarm.mockRejectedValueOnce(error);
  jest
    .mocked(startWarmDeviceSessionHostAsync)
    .mockRejectedValueOnce(new WarmSessionAdoptionError());
  await expect(run()).rejects.toBe(error);
  expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});

it.each(['installer', 'WDA', 'Appium readiness', 'session'])(
  'never cold-replays after adopted app actions when %s fails',
  async stage => {
    const error = new Error(`${stage} failed`);
    if (stage === 'installer') {
      jest.mocked(spawn).mockRejectedValueOnce(error);
    }
    if (stage === 'WDA') {
      jest.mocked(preparePreinstalledWdaAsync).mockRejectedValueOnce(error);
    }
    if (stage === 'session') {
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mockRejectedValueOnce(error);
    }
    const controller = new AbortController();
    if (stage === 'Appium readiness') {
      jest.mocked(turtleFetch).mockImplementationOnce(async () => {
        controller.abort(error);
        throw error;
      });
    }
    await expect(run({}, {}, controller.signal)).rejects.toBe(error);
    expect(startWarmDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
    expect(stopWarm).toHaveBeenCalledTimes(1);
  }
);

it('drains cancelled Appium installation before stopping the adopted controller', async () => {
  const installation = deferred<never>();
  const controller = new AbortController();
  const error = new Error('cancel Appium');
  jest
    .mocked(spawn)
    .mockReturnValueOnce(
      Object.assign(installation.promise, { child: { pid: 987654, kill: jest.fn() } }) as never
    );
  const running = run({}, {}, controller.signal);
  const rejected = expect(running).rejects.toBe(error);
  try {
    await until(() => jest.mocked(spawn).mock.calls.length > 0);
    const home = jest.mocked(spawn).mock.calls[0][2]?.cwd as string;
    controller.abort(error);
    await new Promise(resolve => setImmediate(resolve));
    expect(killProcessGroup).toHaveBeenCalled();
    expect(host.finishAsync).not.toHaveBeenCalled();
    expect(stopWarm).not.toHaveBeenCalled();
    expect(fs.existsSync(home)).toBe(true);
    installation.reject(new Error('installer closed'));
    await rejected;
    expect(fs.existsSync(home)).toBe(false);
    expect(host.finishAsync).toHaveBeenCalledTimes(1);
    expect(stopWarm).toHaveBeenCalledTimes(1);
  } finally {
    installation.reject(error);
    await running.catch(() => {});
  }
});

it('drains Appium process teardown before host finalization and positive controller stop', async () => {
  const stopping = deferred();
  stopAppium.mockReturnValueOnce(stopping.promise);
  const running = run();
  try {
    await until(() => stopAppium.mock.calls.length > 0);
    expect(host.finishAsync).not.toHaveBeenCalled();
    expect(stopWarm).not.toHaveBeenCalled();
    stopping.resolve();
    await running;
    expect(stopTunnel).toHaveBeenCalledTimes(1);
    expect(stopEvents).toHaveBeenCalledTimes(1);
    expect(host.finishAsync).toHaveBeenCalledTimes(1);
    expect(stopWarm).toHaveBeenCalledTimes(1);
  } finally {
    stopping.resolve();
    await running;
  }
});

it('validates Appium version before claiming or starting job resources', async () => {
  await expect(run({ package_version: '2.0.0' })).rejects.toThrow('Appium 3 is required');
  expect(tryClaimWarmIosSessionAsync).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});

it('does not retry even a typed adoption error once Appium setup has begun', async () => {
  const error = new WarmSessionAdoptionError();
  jest.mocked(preparePreinstalledWdaAsync).mockRejectedValueOnce(error);
  await expect(run()).rejects.toBe(error);
  expect(startWarmDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
  expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
  expect(stopWarm).toHaveBeenCalledTimes(1);
});

it('requires the positive controller acknowledgement even if host finalization returns', async () => {
  const error = new Error('no controller teardown acknowledgement');
  stopWarm.mockRejectedValueOnce(error);
  await expect(run()).rejects.toBe(error);
  expect(host.finishAsync).toHaveBeenCalledTimes(1);
  expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
});

it('keeps TURN failure nonfatal and supplies P2P/STUN defaults to the adopted host', async () => {
  jest.mocked(fetchWebPreviewTurnArgsAsync).mockRejectedValueOnce(new Error('TURN unavailable'));
  await run();
  const startup = jest.mocked(startWarmDeviceSessionHostAsync).mock.calls[0][3];
  await expect(startup?.turnArgs).resolves.toEqual([]);
  expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
});

it('does not cold-replay a host app-action failure before Appium setup', async () => {
  const error = new Error('app.launch failed after native video started');
  jest.mocked(startWarmDeviceSessionHostAsync).mockRejectedValueOnce(error);
  await expect(run()).rejects.toBe(error);
  expect(stopWarm).toHaveBeenCalledTimes(1);
  expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});

it('drains cancelled WDA preparation before stopping the adopted controller', async () => {
  const download = deferred<never>();
  const controller = new AbortController();
  const error = new Error('cancel WDA');
  jest.mocked(preparePreinstalledWdaAsync).mockReturnValueOnce(download.promise);
  const running = run({}, {}, controller.signal);
  const rejected = expect(running).rejects.toBe(error);
  try {
    await until(() => jest.mocked(preparePreinstalledWdaAsync).mock.calls.length > 0);
    controller.abort(error);
    await new Promise(resolve => setImmediate(resolve));
    expect(host.finishAsync).not.toHaveBeenCalled();
    expect(stopWarm).not.toHaveBeenCalled();
    expect(spawnDetached).not.toHaveBeenCalled();
    download.reject(new Error('WDA downloader closed'));
    await rejected;
    expect(host.finishAsync).toHaveBeenCalledTimes(1);
    expect(stopWarm).toHaveBeenCalledTimes(1);
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
  } finally {
    download.reject(error);
    await running.catch(() => {});
  }
});

it('starts the warm Appium FFmpeg retry alongside installation and drains it before failure cleanup', async () => {
  const ffmpeg = deferred();
  const installation = deferred<never>();
  const failure = new Error('Appium installation failed');
  jest.mocked(ensureFfmpegInstalledOnceAsync).mockReturnValueOnce(ffmpeg.promise);
  jest.mocked(spawn).mockReturnValueOnce(
    Object.assign(installation.promise, {
      child: { pid: 987654, kill: jest.fn() },
    }) as never
  );
  const running = run();
  const rejected = expect(running).rejects.toBe(failure);
  try {
    await until(() => jest.mocked(spawn).mock.calls.length > 0);
    expect(ensureFfmpegInstalledOnceAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env: expect.objectContaining({ EAS_USE_WARM_SIMULATOR: '1' }),
      })
    );
    installation.reject(failure);
    await new Promise(resolve => setImmediate(resolve));
    expect(host.finishAsync).not.toHaveBeenCalled();
    expect(stopWarm).not.toHaveBeenCalled();
    ffmpeg.resolve();
    await rejected;
    expect(host.finishAsync).toHaveBeenCalledTimes(1);
    expect(stopWarm).toHaveBeenCalledTimes(1);
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
  } finally {
    installation.reject(failure);
    ffmpeg.resolve();
    await running.catch(() => {});
  }
});
