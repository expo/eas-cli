import { BuildPhase, BuildPhaseResult, LogMarker } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import * as ngrok from '@ngrok/ngrok';
import { mkdirSync, writeFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CustomBuildContext } from '../../../customBuildContext';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { verifyLocalEgressGuardAsync } from '../localEgressGuard';
import { type ServeSimApplicationOptions } from '../remoteDeviceRunSession';

import { Sentry } from '../../../sentry';
import { turtleFetch } from '../../../utils/turtleFetch';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import {
  captureDeviceRunSessionPreviewAsync,
  ensureMacosPreviewEncoderInstalledAsync,
  startDeviceRunSessionPreview,
} from '../deviceRunSessionPreview';
import {
  findUnlistedDeviceScreenRecordingsAsync,
  uploadDeviceRunSessionScreenRecordingsAsync,
} from '../deviceRunSessionScreenRecordings';
import * as screenshotCollector from '../deviceRunSessionScreenshots';
import {
  EXPO_DEVICE_HUB_STATE_DIR,
  createServeSimArgs,
  startDeviceSessionHostAsync,
  waitForWebPreviewReadyAsync,
} from '../deviceSessionHost';
import { readIosApplicationIdentifierAsync } from '../iosAppArtifact';
import { readLocalEgressHandoffAsync } from '../localEgress';
import {
  ensureFfmpegInstalledOnceAsync,
  fetchWebPreviewTurnArgsAsync,
  spawnDetached,
} from '../remoteDeviceRunSession';
import { runServeSimActionAsync, stageServeSimAppAsync } from '../serveSimActions';
import { startServeSimActivityPolling } from '../serveSimActivity';
import { readServeSimServersAsync } from '../serveSimMetricsRecorder';

jest.mock('@ngrok/ngrok');
jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/IosSimulatorUtils', () => ({
  IosSimulatorUtils: { disableApsdAsync: jest.fn(), waitForReadyAsync: jest.fn() },
}));
jest.mock('../localEgressGuard', () => ({ verifyLocalEgressGuardAsync: jest.fn() }));
jest.mock('../serveSimActions');
jest.mock('../iosAppArtifact', () => ({
  readIosApplicationIdentifierAsync: jest.fn(),
}));
jest.mock('../serveSimActivity');
jest.mock('../localEgress', () => ({
  ...jest.requireActual('../localEgress'),
  readLocalEgressHandoffAsync: jest.fn().mockResolvedValue(null),
}));
jest.mock('../deviceRunSessionArtifacts');
jest.mock('../../../sentry');
jest.mock('../serveSimMetricsRecorder', () => ({
  readServeSimServersAsync: jest
    .fn()
    .mockResolvedValue([{ udid: 'emulator-5554', token: 'preview-token' }]),
}));
jest.mock('../../../utils/turtleFetch');
jest.mock('../remoteDeviceRunSession', () => ({
  ...jest.requireActual('../remoteDeviceRunSession'),
  ensureFfmpegInstalledOnceAsync: jest.fn(),
  fetchWebPreviewTurnArgsAsync: jest.fn().mockResolvedValue([]),
  spawnDetached: jest.fn(),
}));
jest.mock('../deviceRunSessionPreview', () => ({
  ...jest.requireActual('../deviceRunSessionPreview'),
  ensureMacosPreviewEncoderInstalledAsync: jest.fn(),
  captureDeviceRunSessionPreviewAsync: jest.fn(),
  startDeviceRunSessionPreview: jest.fn(),
}));
jest.mock('../deviceRunSessionScreenRecordings', () => ({
  ...jest.requireActual('../deviceRunSessionScreenRecordings'),
  findUnlistedDeviceScreenRecordingsAsync: jest.fn(),
  uploadDeviceRunSessionScreenRecordingsAsync: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

const env = {
  DEVICE_RUN_SESSION_ID: 'drs-id',
} as BuildStepEnv;
const ctx = {} as CustomBuildContext;
const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as bunyan;
const stopServer = jest.fn();
const closeTunnel = jest.fn();
const directories: string[] = [];
const hubStateFiles: string[] = [];
const baseDomain = 'preview.example.test';
const authtoken = 'ngrok-token';

// expo-device-hub records its session token in `server-<port>.json` before it answers /readyz,
// in the state directory it resolves from its env.
function writeHubState({
  args,
  env: hubEnv,
}: {
  args: readonly string[];
  env: BuildStepEnv;
}): void {
  const port = args[args.indexOf('--port') + 1];
  const stateDir =
    hubEnv.EXPO_DEVICE_HUB_STATE_DIR || path.join(hubEnv.TMPDIR ?? os.tmpdir(), 'expo-device-hub');
  const file = path.join(stateDir, `server-${port}.json`);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ pid: 1, port: Number(port), token: 'hub-preview-token' }));
  hubStateFiles.push(file);
}

async function startHostAsync(separateLogPhase = true) {
  return await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.LINUX,
    env,
    logger,
    separateLogPhase,
    timeoutMs: 10_000,
  });
}

const stopSessionPreview = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(IosSimulatorUtils.disableApsdAsync).mockReset().mockResolvedValue(undefined);
  const installedBundleIds: Record<string, string> = {
    '/artifacts/Application.app': 'test.application',
    '/tmp/Example.app': 'dev.example.app',
    '/tmp/App.app': 'dev.example.other',
    '/tmp/Expo Go.app': 'host.exp.Exponent',
    '/tmp/Fixture.app': 'com.example.fixture',
  };
  jest
    .mocked(readIosApplicationIdentifierAsync)
    .mockReset()
    .mockImplementation(async ({ artifactPath }) => installedBundleIds[artifactPath]);
  jest.mocked(verifyLocalEgressGuardAsync).mockReset().mockResolvedValue(undefined);
  jest.mocked(readLocalEgressHandoffAsync).mockReset().mockResolvedValue(null);
  stopSessionPreview.mockResolvedValue(undefined);
  jest.mocked(startDeviceRunSessionPreview).mockReturnValue({ stopAsync: stopSessionPreview });
  jest.mocked(ensureFfmpegInstalledOnceAsync).mockResolvedValue(undefined);
  jest.mocked(ensureMacosPreviewEncoderInstalledAsync).mockResolvedValue(undefined);
  stopServer.mockResolvedValue(undefined);
  closeTunnel.mockResolvedValue(undefined);
  jest.mocked(uploadDeviceRunSessionScreenRecordingsAsync).mockReset().mockResolvedValue(false);
  jest.mocked(findUnlistedDeviceScreenRecordingsAsync).mockReset().mockResolvedValue([]);
  jest.mocked(spawnDetached).mockImplementation(options => {
    const port = options.args[options.args.indexOf('--port') + 1];
    const device = options.args[options.args.indexOf('@expo/serve-sim@latest') + 1];
    jest.mocked(readServeSimServersAsync).mockResolvedValue([
      {
        udid: device?.startsWith('--') ? 'emulator-5554' : (device ?? 'emulator-5554'),
        token: 'preview-token',
        url: `http://127.0.0.1:${port}`,
      },
    ]);
    const flag = options.args.indexOf('--android-recording-directory');
    if (flag >= 0) {
      directories.push(options.args[flag + 1]);
    }
    if (options.args.includes('--platform')) {
      writeHubState(options);
    }
    return {
      pid: undefined,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopServer,
    };
  });
  jest.mocked(ngrok.forward).mockResolvedValue({
    url: () => 'https://public.example.test',
    close: closeTunnel,
  } as never);
  jest.mocked(turtleFetch).mockImplementation(
    async () =>
      ({
        ok: true,
        json: async () => ({ status: 'ready', device: 'emulator-5554' }),
      }) as Awaited<ReturnType<typeof turtleFetch>>
  );
});

afterEach(async () => {
  jest.useRealTimers();
  await Promise.all(
    [...directories.splice(0), ...hubStateFiles.splice(0)].map(entry =>
      rm(entry, { recursive: true, force: true })
    )
  );
});

it.each([undefined, '', 'invalid serial', 'all', 'booted'])(
  'starts Hub without adding a device restriction for %j',
  async previewDeviceId => {
    const host = await startDeviceSessionHostAsync(ctx, {
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env,
      logger,
      timeoutMs: 10_000,
      previewDeviceId,
    });
    try {
      expect(jest.mocked(spawnDetached).mock.calls[0][0].args).not.toContain('--single-device');
    } finally {
      await host.finishAsync();
    }
  }
);

it('uses the supplied Android serial for Hub and thumbnails without selecting another device', async () => {
  jest.mocked(turtleFetch).mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'ready', device: 'no-device-id' }),
  } as Awaited<ReturnType<typeof turtleFetch>>);
  const host = await startDeviceSessionHostAsync(ctx, {
    runtimePlatform: BuildRuntimePlatform.LINUX,
    env,
    logger,
    timeoutMs: 10_000,
    previewDeviceId: 'emulator-5556',
  });
  try {
    const args = jest.mocked(spawnDetached).mock.calls[0][0].args;
    expect(
      args.slice(args.indexOf('--single-device'), args.indexOf('--single-device') + 2)
    ).toEqual(['--single-device', 'emulator-5556']);
    await new Promise(resolve => setImmediate(resolve));
    await jest
      .mocked(startDeviceRunSessionPreview)
      .mock.calls[0][0].captureAsync(new AbortController().signal);
    expect(captureDeviceRunSessionPreviewAsync).toHaveBeenCalledWith(
      expect.objectContaining({ device: 'emulator-5556' })
    );
  } finally {
    await host.finishAsync();
  }
});

it('pins an already-booted iOS preview without taking over boot or setup', async () => {
  const udid = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
  jest.mocked(turtleFetch).mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'ready', device: udid }),
  } as Awaited<ReturnType<typeof turtleFetch>>);
  const host = await startDeviceSessionHostAsync(ctx, {
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 10_000,
    previewDeviceId: udid,
  });
  try {
    const args = jest.mocked(spawnDetached).mock.calls[0][0].args;
    expect(
      args.slice(args.indexOf('--single-device'), args.indexOf('--single-device') + 2)
    ).toEqual(['--single-device', udid]);
    expect(IosSimulatorUtils.disableApsdAsync).not.toHaveBeenCalled();
    expect(runServeSimActionAsync).not.toHaveBeenCalled();
  } finally {
    await host.finishAsync();
  }
});

it('rejects readiness on a different Simulator from the selected preview target', async () => {
  await expect(
    startDeviceSessionHostAsync(ctx, {
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
      timeoutMs: 10_000,
      previewDeviceId: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
    })
  ).rejects.toThrow('but this session requested AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA');
  expect(stopServer).toHaveBeenCalled();
});

it('targets the selected Simulator in the serve-sim invocation', () => {
  expect(createServeSimArgs({ port: 4321, iosSimulatorUdid: 'session-udid' }).slice(0, 4)).toEqual([
    '@expo/serve-sim@latest',
    'session-udid',
    '--port',
    '4321',
  ]);
});

it('merges Simulator boot variables into the inherited serve-sim environment', async () => {
  const inheritedEnv = {
    ...env,
    SIMCTL_CHILD_HTTP_PROXY: 'http://127.0.0.1:1111',
    HOST_SETTING: 'inherited',
  };
  const bootEnv = {
    SERVE_SIM_ADDITIONAL_DYLIBS: '/tmp/guard lib.dylib:/tmp/extra.dylib',
    SIMCTL_CHILD_EAS_EGRESS_GUARD_MODE: 'block',
    SIMCTL_CHILD_EAS_EGRESS_GUARD_LOG: '/tmp/guard log',
    SIMCTL_CHILD_http_proxy: 'http://127.0.0.1:8899',
    SIMCTL_CHILD_HTTP_PROXY: 'http://127.0.0.1:8899',
  };
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env: inheritedEnv,
    logger,
    timeoutMs: 10_000,
    iosSimulatorUdid: 'emulator-5554',
    bootEnv,
  });
  const invocation = jest.mocked(spawnDetached).mock.calls[0][0];
  expect(invocation.env).toEqual(expect.objectContaining({ ...inheritedEnv, ...bootEnv }));
  expect(invocation.args).not.toEqual(expect.arrayContaining([expect.stringMatching(/^--boot-/)]));
  expect(invocation.env).not.toHaveProperty('EAS_EGRESS_GUARD_MODE');
  expect(invocation.env).not.toHaveProperty('EAS_EGRESS_GUARD_LOG');
  expect(invocation.env).not.toHaveProperty('http_proxy');
  expect(invocation.env).not.toHaveProperty('HTTP_PROXY');
  expect(invocation.env).not.toHaveProperty('DYLD_INSERT_LIBRARIES');
  expect(invocation.env).not.toHaveProperty('DYLD_LIBRARY_PATH');
  expect(invocation.env).not.toHaveProperty('SIMCTL_CHILD_DYLD_INSERT_LIBRARIES');
  expect(inheritedEnv).toEqual({
    ...env,
    SIMCTL_CHILD_HTTP_PROXY: 'http://127.0.0.1:1111',
    HOST_SETTING: 'inherited',
  });
  await host.finishAsync();
});

it('rejects Simulator boot options for Android before acquiring host resources', async () => {
  await expect(
    startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env,
      logger,
      timeoutMs: 10_000,
      iosSimulatorUdid: 'emulator-5554',
      bootEnv: { SERVE_SIM_ADDITIONAL_DYLIBS: '/tmp/guard.dylib' },
    })
  ).rejects.toThrow('Simulator boot options require an explicit iOS Simulator');
  expect(fetchWebPreviewTurnArgsAsync).not.toHaveBeenCalled();
  expect(spawnDetached).not.toHaveBeenCalled();
});

it('rejects boot options without an explicit Simulator before acquiring host resources', async () => {
  await expect(
    startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
      timeoutMs: 10_000,
      bootEnv: { SIMCTL_CHILD_EAS_EGRESS_GUARD_MODE: 'block' },
    })
  ).rejects.toThrow('Simulator boot options require an explicit iOS Simulator');
  expect(fetchWebPreviewTurnArgsAsync).not.toHaveBeenCalled();
  expect(spawnDetached).not.toHaveBeenCalled();
});

it('installs and launches through the API for the selected Simulator', async () => {
  jest
    .mocked(stageServeSimAppAsync)
    .mockResolvedValue({ directory: '/staged', path: '/staged/Example.app' });
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 10_000,
    iosSimulatorUdid: 'emulator-5554',
    installAppPath: '/tmp/Example.app',
    launchAppIdentifier: 'dev.example.app',
    launchArgs: ['--flag'],
    openUrl: 'example://screen',
  });
  expect(verifyLocalEgressGuardAsync).not.toHaveBeenCalled();
  const args = jest.mocked(spawnDetached).mock.calls[0][0].args;
  expect(args).not.toContain('--install-app-path');
  expect(args).not.toContain('--launch-app-identifier');
  expect(runServeSimActionAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'app.install',
      params: { udid: 'emulator-5554', path: '/staged/Example.app' },
    })
  );
  expect(runServeSimActionAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'app.launch',
      params: {
        udid: 'emulator-5554',
        bundleId: 'dev.example.app',
        launchArgs: ['--flag'],
        openUrl: 'example://screen',
        restart: false,
      },
    })
  );
  expect(args[args.indexOf('@expo/serve-sim@latest') + 1]).toBe('emulator-5554');
  await host.finishAsync();
});

it('keeps the restart check when it installs one app and launches another', async () => {
  jest
    .mocked(stageServeSimAppAsync)
    .mockResolvedValue({ directory: '/staged', path: '/staged/Fixture.app' });
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 10_000,
    iosSimulatorUdid: 'emulator-5554',
    installAppPath: '/tmp/Fixture.app',
    launchAppIdentifier: 'host.exp.Exponent',
  });
  const launch = jest
    .mocked(runServeSimActionAsync)
    .mock.calls.map(([call]) => call)
    .find(call => call.action === 'app.launch');
  expect(launch?.params).not.toHaveProperty('restart');
  await host.finishAsync();
});

it('keeps the restart check when it launches an app it did not install', async () => {
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 10_000,
    iosSimulatorUdid: 'emulator-5554',
    launchAppIdentifier: 'dev.example.app',
  });
  expect(runServeSimActionAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'app.launch',
      params: {
        udid: 'emulator-5554',
        bundleId: 'dev.example.app',
        launchArgs: [],
        openUrl: undefined,
      },
    })
  );
  await host.finishAsync();
});

it('preserves startup CLI flags for already-prepared workflows', async () => {
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 10_000,
    installAppPath: '/tmp/Example.app',
    launchAppIdentifier: 'dev.example.app',
    launchArgs: ['--flag', 'literal value'],
    openUrl: 'example://screen',
  });
  const args = jest.mocked(spawnDetached).mock.calls[0][0].args;
  expect(args).toEqual(
    expect.arrayContaining([
      '--install-app-path',
      '/tmp/Example.app',
      '--launch-app-identifier',
      'dev.example.app',
      '--launch-arg',
      '--flag',
      'literal value',
      '--open-url',
      'example://screen',
    ])
  );
  expect(args.slice(args.indexOf('--launch-arg'), args.indexOf('--open-url'))).toEqual([
    '--launch-arg',
    '--flag',
    '--launch-arg',
    'literal value',
  ]);
  expect(runServeSimActionAsync).not.toHaveBeenCalled();
  expect(IosSimulatorUtils.disableApsdAsync).not.toHaveBeenCalled();
  expect(verifyLocalEgressGuardAsync).not.toHaveBeenCalled();
  await host.finishAsync();
});

it('defaults owned Simulator startup to a long cold-boot budget', async () => {
  jest.useFakeTimers();
  const startedAt = Date.now();
  const readyResponse = jest.mocked(turtleFetch).getMockImplementation()!;
  jest.mocked(turtleFetch).mockImplementation(async (...args) => {
    if (Date.now() - startedAt < 65_000) {
      throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    }
    return await readyResponse(...args);
  });
  const starting = startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 60_000,
    iosSimulatorUdid: 'emulator-5554',
    launchAppIdentifier: 'dev.example.app',
  });
  const resolved = expect(starting).resolves.toBeDefined();
  await jest.advanceTimersByTimeAsync(65_000);
  await resolved;
  const host = await starting;
  expect(runServeSimActionAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'app.launch',
      timeoutMs: 30 * 60_000,
    })
  );
  await host.finishAsync();
});

it('allows a cold boot to take longer than the normal host startup deadline', async () => {
  jest.useFakeTimers();
  const startedAt = Date.now();
  const readyResponse = jest.mocked(turtleFetch).getMockImplementation()!;
  jest.mocked(turtleFetch).mockImplementation(async (...args) => {
    if (Date.now() - startedAt < 65_000) {
      throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    }
    return await readyResponse(...args);
  });
  const waiting = waitForWebPreviewReadyAsync({
    previewServer: { pid: undefined, getOutput: () => '' },
    serverName: 'serve-sim',
    port: 4321,
    timeoutMs: 60_000,
    startupTimeoutMs: 30 * 60_000,
  });
  await jest.advanceTimersByTimeAsync(65_000);
  await expect(waiting).resolves.toBe('emulator-5554');
});

it('uses the shorter startup deadline after a cold host starts responding', async () => {
  jest.useFakeTimers();
  jest.mocked(turtleFetch).mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({ status: 'starting' }),
  } as Awaited<ReturnType<typeof turtleFetch>>);
  const waiting = waitForWebPreviewReadyAsync({
    previewServer: { pid: undefined, getOutput: () => '' },
    serverName: 'serve-sim',
    port: 4321,
    timeoutMs: 60_000,
    startupTimeoutMs: 30 * 60_000,
  });
  const rejected = expect(waiting).rejects.toThrow('HTTP 503');
  await jest.advanceTimersByTimeAsync(60_000);
  await rejected;
});

it('uses the shorter startup deadline when a listening host never answers readiness', async () => {
  jest.useFakeTimers();
  jest
    .mocked(turtleFetch)
    .mockRejectedValue(Object.assign(new Error('network timeout'), { type: 'request-timeout' }));
  const waiting = waitForWebPreviewReadyAsync({
    previewServer: { pid: undefined, getOutput: () => '' },
    serverName: 'serve-sim',
    port: 4321,
    timeoutMs: 60_000,
    startupTimeoutMs: 30 * 60_000,
  });
  const rejected = expect(waiting).rejects.toThrow('network timeout');
  await jest.advanceTimersByTimeAsync(60_000);
  await rejected;
});

it('starts the readiness budget after refusals that exceed the normal startup deadline', async () => {
  jest.useFakeTimers();
  const startedAt = Date.now();
  jest.mocked(turtleFetch).mockImplementation(async () => {
    if (Date.now() - startedAt < 65_000) {
      throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    }
    throw Object.assign(new Error('network timeout'), { type: 'request-timeout' });
  });
  const waiting = waitForWebPreviewReadyAsync({
    previewServer: { pid: undefined, getOutput: () => '' },
    serverName: 'serve-sim',
    port: 4321,
    timeoutMs: 60_000,
    startupTimeoutMs: 30 * 60_000,
  });
  let settled = false;
  void waiting.catch(() => {
    settled = true;
  });
  const rejected = expect(waiting).rejects.toThrow('network timeout');
  await jest.advanceTimersByTimeAsync(65_000 + 59_000);
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(1_000);
  await rejected;
});

it('reports preview activity from serve-sim on iOS and stops polling when finished', async () => {
  const observedAt = new Date('2026-10-19T12:00:00Z');
  const stopActivity = jest.fn().mockResolvedValue(undefined);
  jest.mocked(startServeSimActivityPolling).mockReturnValue({
    getLastActivityObservedAt: () => observedAt,
    stopAsync: stopActivity,
  });
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 10_000,
  });
  const port = Number(
    jest.mocked(spawnDetached).mock.calls[0][0].args[
      jest.mocked(spawnDetached).mock.calls[0][0].args.indexOf('--port') + 1
    ]
  );

  expect(startServeSimActivityPolling).toHaveBeenCalledWith({
    port,
    token: 'preview-token',
    logger: expect.anything(),
  });
  expect(host.getLastPreviewActivityAt()).toBe(observedAt);

  await host.finishAsync();
  expect(stopActivity).toHaveBeenCalledTimes(1);
});

it('does not start polling preview activity when startup is cancelled', async () => {
  const controller = new AbortController();
  jest.mocked(IosSimulatorUtils.disableApsdAsync).mockImplementation(async () => {
    controller.abort(new Error('cancelled'));
  });
  await expect(
    startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      iosSimulatorUdid: 'emulator-5554',
      env,
      logger,
      timeoutMs: 10_000,
      signal: controller.signal,
    })
  ).rejects.toThrow();
  expect(startServeSimActivityPolling).not.toHaveBeenCalled();
});

it('reports no preview activity on Android, where expo-device-hub keeps no event log', async () => {
  const host = await startHostAsync();

  expect(startServeSimActivityPolling).not.toHaveBeenCalled();
  expect(host.getLastPreviewActivityAt()).toBeUndefined();
  await host.finishAsync();
});

it('stops a host that became ready on a different Simulator', async () => {
  await expect(
    startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      iosSimulatorUdid: 'session-udid',
      env,
      logger,
      timeoutMs: 10_000,
    })
  ).rejects.toThrow('became ready on emulator-5554, but this session requested session-udid');
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(closeTunnel).toHaveBeenCalledTimes(1);
});

it('stops a host when a cold boot is cancelled during readiness polling', async () => {
  const controller = new AbortController();
  const cancelled = new Error('session cancelled');
  jest.mocked(turtleFetch).mockImplementationOnce(async (_url, _method, options) => {
    expect(options?.signal?.aborted).toBe(false);
    controller.abort(cancelled);
    expect(options?.signal?.reason).toBe(cancelled);
    throw new Error('readiness request aborted');
  });
  await expect(
    startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      iosSimulatorUdid: 'session-udid',
      env,
      logger,
      timeoutMs: 30 * 60_000,
      signal: controller.signal,
    })
  ).rejects.toBe(cancelled);
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(closeTunnel).toHaveBeenCalledTimes(jest.mocked(ngrok.forward).mock.calls.length);
  const directory =
    jest.mocked(spawnDetached).mock.calls[0][0].env.EXPO_DEVICE_HUB_SCREENSHOT_DIRECTORY;
  await expect(access(directory!)).rejects.toThrow();
});

it('records by default and finalizes before process stop, uploading exactly once', async () => {
  const host = await startHostAsync();
  const directory = directories[0];
  const recordings = [
    {
      udid: 'emulator-5554',
      deviceName: 'Pixel',
      runtimeDisplayName: 'Android 16',
      directory: path.join(directory, 'session'),
    },
  ];
  await writeFile(path.join(directory, 'recordings.json'), JSON.stringify(recordings));
  await mkdir(recordings[0].directory);
  const started = deferred<void>();
  const response = deferred<Awaited<ReturnType<typeof turtleFetch>>>();
  jest.mocked(turtleFetch).mockImplementationOnce(async () => {
    started.resolve();
    return await response.promise;
  });
  const finishing = host.finishAsync();
  expect(host.finishAsync()).toBe(finishing);
  await started.promise;
  expect(stopServer).not.toHaveBeenCalled();
  expect(uploadDeviceRunSessionScreenRecordingsAsync).not.toHaveBeenCalled();
  const token =
    jest.mocked(spawnDetached).mock.calls[0][0].env.EXPO_DEVICE_HUB_RECORDING_CONTROL_TOKEN;
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(turtleFetch).toHaveBeenLastCalledWith(
    expect.stringMatching(/\/_eas\/android-recording\/stop$/),
    'POST',
    {
      headers: { Authorization: `Bearer ${token}` },
      retries: 0,
      shouldThrowOnNotOk: false,
      signal: expect.any(AbortSignal),
    }
  );
  response.resolve({ ok: true } as Awaited<ReturnType<typeof turtleFetch>>);
  await finishing;
  await host.finishAsync();
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(uploadDeviceRunSessionScreenRecordingsAsync).toHaveBeenCalledTimes(1);
  expect(uploadDeviceRunSessionScreenRecordingsAsync).toHaveBeenCalledWith(ctx, {
    logger,
    deviceRunSessionId: 'drs-id',
    recordings,
  });
  expect(stopServer.mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(uploadDeviceRunSessionScreenRecordingsAsync).mock.invocationCallOrder[0]
  );
  await expect(host.openPreviewAsync()).rejects.toThrow('after session host finalization');
});

it('coalesces preview opens and allows close/reopen without ending capture', async () => {
  const host = await startHostAsync();
  const opening = host.openPreviewAsync();
  expect(host.openPreviewAsync()).toBe(opening);
  const first = await opening;
  const closing = first.closeAsync();
  expect(first.closeAsync()).toBe(closing);
  await closing;
  const secondClose = jest.fn().mockResolvedValue(undefined);
  jest.mocked(ngrok.forward).mockResolvedValueOnce({
    url: () => 'https://replacement.example.test',
    close: secondClose,
  } as never);
  const second = await host.openPreviewAsync();
  await first.closeAsync();
  expect(await host.openPreviewAsync()).toBe(second);
  expect(secondClose).not.toHaveBeenCalled();
  expect(spawnDetached).toHaveBeenCalledTimes(1);
  expect(stopServer).not.toHaveBeenCalled();
  expect(uploadDeviceRunSessionScreenRecordingsAsync).not.toHaveBeenCalled();
  expect(jest.mocked(turtleFetch).mock.calls.some(([, method]) => method === 'POST')).toBe(false);
  await host.finishAsync();
  expect(closeTunnel).toHaveBeenCalledTimes(1);
  expect(secondClose).toHaveBeenCalledTimes(1);
  expect(stopServer).toHaveBeenCalledTimes(1);
});

it('opens the preview tunnel during startup', async () => {
  const host = await startHostAsync();
  expect(ngrok.forward).toHaveBeenCalledTimes(1);
  expect(await host.openPreviewAsync()).toMatchObject({ apiUrl: 'https://public.example.test' });
  expect(ngrok.forward).toHaveBeenCalledTimes(1);
  await host.finishAsync();
});

it('retries a failed tunnel without restarting the host', async () => {
  const host = await startHostAsync();
  await (await host.openPreviewAsync()).closeAsync();
  jest.mocked(ngrok.forward).mockRejectedValueOnce(new Error('tunnel unavailable'));
  await expect(host.openPreviewAsync()).rejects.toThrow('tunnel unavailable');
  expect(stopServer).not.toHaveBeenCalled();
  await host.openPreviewAsync();
  expect(spawnDetached).toHaveBeenCalledTimes(1);
  await host.finishAsync();
  expect(closeTunnel).toHaveBeenCalledTimes(2);
});

it('drains an in-flight tunnel when finishing and rejects new opens', async () => {
  const host = await startHostAsync();
  await (await host.openPreviewAsync()).closeAsync();
  const tunnel = deferred<Awaited<ReturnType<typeof ngrok.forward>>>();
  jest.mocked(ngrok.forward).mockReturnValueOnce(tunnel.promise);
  const opening = host.openPreviewAsync();
  const finishing = host.finishAsync();
  await expect(host.openPreviewAsync()).rejects.toThrow('after session host finalization');
  tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
  await expect(opening).rejects.toThrow('finalized while the preview was opening');
  await finishing;
  expect(closeTunnel).toHaveBeenCalledTimes(2);
  expect(stopServer).toHaveBeenCalledTimes(1);
});

it('keeps cleanup and upload best-effort when tunnel close and finalization fail', async () => {
  jest.mocked(spawnDetached).mockImplementationOnce(options => {
    directories.push(options.args[options.args.indexOf('--android-recording-directory') + 1]);
    writeHubState(options);
    return {
      pid: undefined,
      getOutput: () => '[serve-emu] emulator-5554 capture error: scrcpy exited with code 255',
      getExitError: () => undefined,
      stopAsync: stopServer,
    };
  });
  const host = await startHostAsync();
  await writeFile(path.join(directories[0], 'recordings.json'), '[]');
  await host.openPreviewAsync();
  closeTunnel.mockRejectedValueOnce(new Error('tunnel close failure'));
  jest.mocked(turtleFetch).mockResolvedValueOnce({
    ok: false,
    status: 500,
    text: async () => 'Error: scrcpy exited with code 255',
  } as Awaited<ReturnType<typeof turtleFetch>>);
  await host.finishAsync();
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    {
      err: expect.objectContaining({
        message: expect.stringContaining('HTTP 500: Error: scrcpy exited with code 255'),
      }),
    },
    'Could not finalize Android recording before shutdown.'
  );
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not finalize Android recording before shutdown',
    expect.any(Error),
    { level: 'warning' }
  );
  expect(uploadDeviceRunSessionScreenRecordingsAsync).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    { hostOutput: '[serve-emu] emulator-5554 capture error: scrcpy exited with code 255' },
    'Session host output around the recording failure.'
  );
});

it('logs the reason and skips upload and output dump when the Hub never recorded', async () => {
  jest.mocked(spawnDetached).mockImplementationOnce(options => {
    directories.push(options.args[options.args.indexOf('--android-recording-directory') + 1]);
    writeHubState(options);
    return {
      pid: undefined,
      getOutput: () => '[serve-emu] Android recording skipped',
      getExitError: () => undefined,
      stopAsync: stopServer,
    };
  });
  const host = await startHostAsync();
  jest.mocked(turtleFetch).mockResolvedValueOnce({
    ok: false,
    status: 409,
    text: async () => 'Android recording requires exactly one booted emulator; found 0.',
  } as Awaited<ReturnType<typeof turtleFetch>>);
  await host.finishAsync();
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    'Android recording was not captured: Android recording requires exactly one booted emulator; found 0.'
  );
  expect(uploadDeviceRunSessionScreenRecordingsAsync).not.toHaveBeenCalled();
  expect(logger.warn).not.toHaveBeenCalledWith(
    expect.anything(),
    'Session host output around the recording failure.'
  );
});

it('rolls back failed host startup without replacing the original error', async () => {
  stopServer.mockRejectedValueOnce(new Error('stop failure'));
  await expect(
    startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env,
      logger,
      timeoutMs: 0,
    })
  ).rejects.toThrow('Timed out waiting');
  expect(stopServer).toHaveBeenCalledTimes(1);
  const directory =
    jest.mocked(spawnDetached).mock.calls[0][0].env.EXPO_DEVICE_HUB_SCREENSHOT_DIRECTORY;
  if (!directory) {
    throw new Error('Missing screenshot artifact directory');
  }
  // The host could not be stopped, so it may still write captures there.
  await expect(access(directory)).resolves.toBeUndefined();
  expect(closeTunnel).toHaveBeenCalledTimes(jest.mocked(ngrok.forward).mock.calls.length);
  expect(jest.mocked(turtleFetch).mock.calls.some(([, method]) => method === 'POST')).toBe(false);
  expect(uploadDeviceRunSessionScreenRecordingsAsync).not.toHaveBeenCalled();
  const hostStillRunning =
    'The session host is still running, so preview screenshots it saves from now on are not uploaded.';
  expect(logger.warn).toHaveBeenCalledWith({ directory }, hostStillRunning);
  const recordingWarnings = jest
    .mocked(logger.warn)
    .mock.calls.map(([, message]) => message)
    .filter(message => message !== hostStillRunning);
  expect(recordingWarnings).not.toContainEqual(expect.stringMatching(/finalize|upload/));
});

async function writeRecordingDescriptorAsync(directory: string) {
  const child = path.join(directory, 'session');
  await mkdir(child);
  await writeFile(
    path.join(directory, 'recordings.json'),
    JSON.stringify([
      {
        udid: 'emulator-5554',
        deviceName: 'Pixel',
        runtimeDisplayName: 'Android',
        directory: child,
      },
    ])
  );
}

it.each([true, false])(
  'removes its recording root only when every upload succeeds (%s)',
  async uploaded => {
    const host = await startHostAsync();
    const directory = directories[0];
    await writeRecordingDescriptorAsync(directory);
    jest.mocked(uploadDeviceRunSessionScreenRecordingsAsync).mockResolvedValueOnce(uploaded);
    await host.finishAsync();
    if (uploaded) {
      await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      await expect(access(directory)).resolves.toBeUndefined();
    }
  }
);

it('finishes despite a stalled tunnel close', async () => {
  const host = await startHostAsync();
  await host.openPreviewAsync();
  const closing = deferred<void>();
  closeTunnel.mockReturnValueOnce(closing.promise);
  jest.useFakeTimers();
  const finishing = host.finishAsync();
  await jest.advanceTimersByTimeAsync(5_000);
  await finishing;
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('deadline'));
  expect(logger.info).toHaveBeenCalledWith(
    { marker: LogMarker.END_PHASE, result: BuildPhaseResult.FAIL },
    'End phase: Simulator preview'
  );
  closing.resolve();
});

it('aborts a stalled finalization request before stopping the host', async () => {
  const host = await startHostAsync();
  const response = deferred<Awaited<ReturnType<typeof turtleFetch>>>();
  jest.mocked(turtleFetch).mockReturnValueOnce(response.promise);
  jest.useFakeTimers();
  const finishing = host.finishAsync();
  await jest.advanceTimersByTimeAsync(60_000);
  await finishing;
  const options = jest.mocked(turtleFetch).mock.calls.at(-1)?.[2];
  expect(options?.signal?.aborted).toBe(true);
  expect(stopServer).toHaveBeenCalledTimes(1);
  response.resolve({ ok: true } as Awaited<ReturnType<typeof turtleFetch>>);
});

it('uploads the partial recording a killed host left behind and then removes the root', async () => {
  const host = await startHostAsync();
  const directory = directories[0];
  const child = path.join(directory, 'session');
  await mkdir(child);
  await writeFile(path.join(directory, 'recordings.json'), '[]');
  const partial = [
    { udid: 'emulator-5554', deviceName: 'Pixel', runtimeDisplayName: 'Android', directory: child },
  ];
  jest.mocked(findUnlistedDeviceScreenRecordingsAsync).mockResolvedValueOnce(partial);
  jest.mocked(uploadDeviceRunSessionScreenRecordingsAsync).mockResolvedValueOnce(true);
  await host.finishAsync();
  expect(findUnlistedDeviceScreenRecordingsAsync).toHaveBeenCalledWith({
    root: directory,
    env,
    logger,
  });
  expect(uploadDeviceRunSessionScreenRecordingsAsync).toHaveBeenCalledWith(ctx, {
    logger,
    deviceRunSessionId: 'drs-id',
    recordings: partial,
  });
  await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects descriptors outside its recording root', async () => {
  const host = await startHostAsync();
  const directory = directories[0];
  await writeFile(
    path.join(directory, 'recordings.json'),
    JSON.stringify([
      {
        udid: 'emulator-5554',
        deviceName: 'Pixel',
        runtimeDisplayName: 'Android',
        directory: path.dirname(directory),
      },
    ])
  );
  await host.finishAsync();
  expect(uploadDeviceRunSessionScreenRecordingsAsync).not.toHaveBeenCalled();
  await expect(access(directory)).resolves.toBeUndefined();
});

it('retains recordings without uploading if the host cannot be stopped', async () => {
  const host = await startHostAsync();
  const directory = directories[0];
  await writeRecordingDescriptorAsync(directory);
  stopServer.mockRejectedValueOnce(new Error('process stop failed'));
  await host.finishAsync();
  expect(uploadDeviceRunSessionScreenRecordingsAsync).not.toHaveBeenCalled();
  await expect(access(directory)).resolves.toBeUndefined();
});

it('closes a listener that arrives after finish has already timed out waiting for it', async () => {
  const host = await startHostAsync();
  await (await host.openPreviewAsync()).closeAsync();
  const tunnel = deferred<Awaited<ReturnType<typeof ngrok.forward>>>();
  jest.mocked(ngrok.forward).mockReturnValueOnce(tunnel.promise);
  const opening = host.openPreviewAsync();
  const rejected = expect(opening).rejects.toThrow('finalized while the preview was opening');
  jest.useFakeTimers();
  const finishing = host.finishAsync();
  await jest.advanceTimersByTimeAsync(5_000);
  await finishing;
  expect(stopServer).toHaveBeenCalledTimes(1);
  tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
  await rejected;
  expect(closeTunnel).toHaveBeenCalledTimes(2);
});

// The same session token and website origins as the serve-sim host on iOS.
it('starts expo-device-hub with a session token and the website origins', async () => {
  const host = await startHostAsync();
  const { args } = jest.mocked(spawnDetached).mock.calls[0][0];
  expect(args).toContain('--require-token');
  expect(args.join(' ')).toContain(
    '--cors-origin https://expo.dev --frame-ancestor https://expo.dev'
  );
  const preview = await host.openPreviewAsync();
  expect(preview.previewToken).toBe('hub-preview-token');
  await host.finishAsync();
});

it.each([
  ['its own state directory', 'EXPO_DEVICE_HUB_STATE_DIR'],
  ['its own TMPDIR', 'TMPDIR'],
])('reads the Hub token when the step env sets %s', async (_description, variable) => {
  const override = await mkdtemp(path.join(os.tmpdir(), 'hub-state-override-'));
  directories.push(override);
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.LINUX,
    env: { ...env, [variable]: override },
    logger,
    separateLogPhase: true,
    timeoutMs: 10_000,
  });
  const options = jest.mocked(spawnDetached).mock.calls[0][0];
  expect(options.env.EXPO_DEVICE_HUB_STATE_DIR).toBe(EXPO_DEVICE_HUB_STATE_DIR);
  expect((await host.openPreviewAsync()).previewToken).toBe('hub-preview-token');
  await host.finishAsync();
});

it('lets the session add frame ancestors and CORS origins after the website origins', async () => {
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.LINUX,
    env,
    logger,
    separateLogPhase: true,
    timeoutMs: 10_000,
    frameAncestors: ['https://embed.example.test', 'https://*.example.test'],
    corsOrigins: ['https://app.example.test'],
  });
  const { args } = jest.mocked(spawnDetached).mock.calls[0][0];
  expect(args.join(' ')).toContain(
    '--frame-ancestor https://expo.dev --frame-ancestor https://embed.example.test --frame-ancestor https://*.example.test --cors-origin https://app.example.test'
  );
  await host.finishAsync();
});

it('stops when expo-device-hub records no session token', async () => {
  jest.mocked(spawnDetached).mockImplementationOnce(options => {
    const flag = options.args.indexOf('--android-recording-directory');
    directories.push(options.args[flag + 1]);
    return {
      pid: undefined,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopServer,
    };
  });
  await expect(startHostAsync()).rejects.toThrow(
    'expo-device-hub became ready but wrote no session token'
  );
  expect(stopServer).toHaveBeenCalledTimes(1);
});

it('leaves iOS recording to its existing build steps', async () => {
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    separateLogPhase: true,
    timeoutMs: 10_000,
  });
  const options = jest.mocked(spawnDetached).mock.calls[0][0];
  expect(options.args).not.toContain('--android-recording-directory');
  expect(options.env.EXPO_DEVICE_HUB_RECORDING_CONTROL_TOKEN).toBeUndefined();
  await host.finishAsync();
  expect(jest.mocked(turtleFetch).mock.calls.some(([, method]) => method === 'POST')).toBe(false);
  expect(uploadDeviceRunSessionScreenRecordingsAsync).not.toHaveBeenCalled();
  expect(stopServer).toHaveBeenCalledTimes(1);
});

const turnArgs = [
  '--turn-url',
  'turn:turn.example.test:3478',
  '--turn-username',
  'turn-user',
  '--turn-credential',
  'turn-secret',
];

it('passes the TURN credential and the Android control token to the host as secrets, and adds the session token once the Hub is ready', async () => {
  jest.mocked(fetchWebPreviewTurnArgsAsync).mockResolvedValueOnce(turnArgs);
  const spawn = jest.mocked(spawnDetached).getMockImplementation()!;
  let secretsAtSpawn: string[] | undefined;
  jest.mocked(spawnDetached).mockImplementationOnce(options => {
    secretsAtSpawn = [...(options.secrets ?? [])];
    return spawn(options);
  });
  const host = await startHostAsync();
  const options = jest.mocked(spawnDetached).mock.calls[0][0];
  const controlToken = options.env.EXPO_DEVICE_HUB_RECORDING_CONTROL_TOKEN;
  expect(controlToken).toMatch(/^[a-f0-9]{64}$/);
  expect(secretsAtSpawn).toEqual(['turn-secret', controlToken]);
  // Host output is redacted against this array, so the token must land in the one passed at spawn.
  expect(options.secrets).toEqual(['turn-secret', controlToken, 'hub-preview-token']);
  await host.finishAsync();
});

it('adds the iOS preview token to the host secrets once serve-sim is ready', async () => {
  jest.mocked(fetchWebPreviewTurnArgsAsync).mockResolvedValueOnce(turnArgs);
  let secretsAtSpawn: string[] | undefined;
  jest.mocked(spawnDetached).mockImplementationOnce(options => {
    secretsAtSpawn = [...(options.secrets ?? [])];
    return {
      pid: undefined,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopServer,
    };
  });
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    separateLogPhase: true,
    timeoutMs: 10_000,
  });
  expect(secretsAtSpawn).toEqual(['turn-secret']);
  // Host output is redacted against this array, so the token must land in the one passed at spawn.
  expect(jest.mocked(spawnDetached).mock.calls[0][0].secrets).toEqual([
    'turn-secret',
    'preview-token',
  ]);
  expect((await host.openPreviewAsync()).previewToken).toBe('preview-token');
  await host.finishAsync();
});

it('keeps the preview phase open until shutdown output has been logged', async () => {
  const previewLogger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
  jest.mocked(logger.child).mockReturnValueOnce(previewLogger);
  const host = await startHostAsync();
  expect(logger.child).toHaveBeenCalledWith({
    phase: BuildPhase.CUSTOM,
    buildStepId: expect.stringMatching(/^step-\d{3,}$/),
    buildStepDisplayName: 'Simulator preview',
  });
  expect(spawnDetached).toHaveBeenCalledWith(expect.objectContaining({ logger: previewLogger }));
  expect(previewLogger.info).not.toHaveBeenCalledWith(
    expect.objectContaining({ marker: LogMarker.END_PHASE }),
    expect.anything()
  );
  stopServer.mockImplementationOnce(async () => previewLogger.info('shutdown output'));
  await host.finishAsync();
  await host.finishAsync();
  const calls = jest.mocked(previewLogger.info).mock.calls;
  const endings = calls.filter(([fields]) => fields?.marker === LogMarker.END_PHASE);
  expect(endings).toEqual([
    [
      { marker: LogMarker.END_PHASE, result: BuildPhaseResult.SUCCESS },
      'End phase: Simulator preview',
    ],
  ]);
  expect(calls.findIndex(([message]) => message === 'shutdown output')).toBeLessThan(
    calls.length - 1
  );
});

it('ends the preview phase before waiting for screenshot uploads', async () => {
  const previewLogger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
  jest.mocked(logger.child).mockReturnValueOnce(previewLogger);
  const uploading = deferred<void>();
  const uploaded = deferred<void>();
  const finishScreenshots = jest.fn(async () => {
    uploading.resolve();
    await uploaded.promise;
  });
  const collector = jest
    .spyOn(screenshotCollector, 'startDeviceRunSessionScreenshotsAsync')
    .mockResolvedValueOnce({ directory: '/tmp/screenshots', finishAsync: finishScreenshots });
  try {
    const host = await startHostAsync();
    const finishing = host.finishAsync();
    let finished = false;
    void finishing.then(() => {
      finished = true;
    });
    await uploading.promise;
    expect(stopServer).toHaveBeenCalledTimes(1);
    expect(previewLogger.info).toHaveBeenCalledWith(
      { marker: LogMarker.END_PHASE, result: BuildPhaseResult.SUCCESS },
      'End phase: Simulator preview'
    );
    expect(finished).toBe(false);
    uploaded.resolve();
    await finishing;
    expect(collector).toHaveBeenCalledWith(ctx, expect.objectContaining({ logger }));
  } finally {
    uploaded.resolve();
    collector.mockRestore();
  }
});

it('ends the preview phase with failure when spawning fails', async () => {
  jest.mocked(spawnDetached).mockImplementationOnce(() => {
    throw new Error('could not spawn');
  });
  await expect(startHostAsync()).rejects.toThrow('could not spawn');
  expect(logger.info).toHaveBeenCalledWith(
    { marker: LogMarker.END_PHASE, result: BuildPhaseResult.FAIL },
    'End phase: Simulator preview'
  );
});

it('ends the preview phase with failure when the host cannot stop', async () => {
  const previewLogger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
  jest.mocked(logger.child).mockReturnValueOnce(previewLogger);
  const host = await startHostAsync();
  stopServer.mockRejectedValueOnce(new Error('could not stop'));
  await host.finishAsync();
  expect(previewLogger.warn).toHaveBeenCalledWith(
    expect.anything(),
    'Could not stop the expo-device-hub session host.'
  );
  expect(logger.warn).not.toHaveBeenCalledWith(
    expect.anything(),
    'Could not stop the expo-device-hub session host.'
  );
  expect(previewLogger.info).toHaveBeenCalledWith(
    { marker: LogMarker.END_PHASE, result: BuildPhaseResult.FAIL },
    'End phase: Simulator preview'
  );
});

it.each([
  ['exited during the session', true, BuildPhaseResult.FAIL],
  ['exited only when stopped', false, BuildPhaseResult.SUCCESS],
])('finishes cleanup and uploads when the host %s', async (_description, exitedEarly, result) => {
  let exitError: Error | undefined;
  jest.mocked(spawnDetached).mockImplementationOnce(options => {
    directories.push(options.args[options.args.indexOf('--android-recording-directory') + 1]);
    writeHubState(options);
    return {
      pid: undefined,
      getOutput: () => '',
      getExitError: () => exitError,
      stopAsync: stopServer,
    };
  });
  stopServer.mockImplementationOnce(async () => {
    exitError ??= new Error('Process exited with signal SIGTERM.');
  });
  const host = await startHostAsync();
  await host.openPreviewAsync();
  const directory = directories[0];
  await writeRecordingDescriptorAsync(directory);
  jest.mocked(uploadDeviceRunSessionScreenRecordingsAsync).mockResolvedValueOnce(true);
  const screenshotDirectory =
    jest.mocked(spawnDetached).mock.calls[0][0].env.EXPO_DEVICE_HUB_SCREENSHOT_DIRECTORY;
  if (!screenshotDirectory) {
    throw new Error('Missing screenshot artifact directory');
  }
  if (exitedEarly) {
    exitError = new Error('Process exited with code 1.');
  }
  await host.finishAsync();
  expect(closeTunnel).toHaveBeenCalledTimes(1);
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(uploadDeviceRunSessionScreenRecordingsAsync).toHaveBeenCalledTimes(1);
  await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(screenshotDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(logger.info).toHaveBeenCalledWith(
    { marker: LogMarker.END_PHASE, result },
    'End phase: Simulator preview'
  );
});

it('ends the preview phase with failure when the tunnel cannot close', async () => {
  const host = await startHostAsync();
  await host.openPreviewAsync();
  closeTunnel.mockRejectedValue(new Error('tunnel close failure'));
  jest.useFakeTimers();
  const finishing = host.finishAsync();
  await jest.advanceTimersByTimeAsync(4_000);
  await finishing;
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(logger.info).toHaveBeenCalledWith(
    { marker: LogMarker.END_PHASE, result: BuildPhaseResult.FAIL },
    'End phase: Simulator preview'
  );
  closeTunnel.mockResolvedValue(undefined);
});

it('ends the preview phase with failure when startup never provides a token', async () => {
  const metrics = jest.requireMock('../serveSimMetricsRecorder');
  metrics.readServeSimServersAsync.mockResolvedValueOnce([]);
  await expect(
    startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
      separateLogPhase: true,
      timeoutMs: 10_000,
    })
  ).rejects.toThrow('wrote no session token');
  expect(logger.info).toHaveBeenCalledWith(
    { marker: LogMarker.END_PHASE, result: BuildPhaseResult.FAIL },
    'End phase: Simulator preview'
  );
});

it('fails startup and ends the preview phase with failure if opening the tunnel fails', async () => {
  jest.mocked(ngrok.forward).mockRejectedValueOnce(new Error('tunnel unavailable'));
  await expect(startHostAsync()).rejects.toThrow('tunnel unavailable');
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(logger.info).toHaveBeenCalledWith(
    { marker: LogMarker.END_PHASE, result: BuildPhaseResult.FAIL },
    'End phase: Simulator preview'
  );
});

it.each([BuildRuntimePlatform.LINUX, BuildRuntimePlatform.DARWIN])(
  'uploads screenshots and flushes them exactly once when the %s host finishes',
  async runtimePlatform => {
    const uploads: Buffer[] = [];
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockImplementation(async (_ctx, { openStream }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of openStream()) {
          chunks.push(Buffer.from(chunk));
        }
        uploads.push(Buffer.concat(chunks));
      });
    const host = await startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform,
      env,
      logger,
      timeoutMs: 10_000,
    });
    await host.openPreviewAsync();
    const directory =
      jest.mocked(spawnDetached).mock.calls[0][0].env.EXPO_DEVICE_HUB_SCREENSHOT_DIRECTORY;
    if (!directory) {
      throw new Error('Missing screenshot artifact directory');
    }
    await writeFile(
      path.join(directory, 'screenshot-2026-09-24T08-45-59-123Z-a1b2c3d4e5f6.png'),
      'manual-capture'
    );
    let directoryWhenStopping: string[] | undefined;
    stopServer.mockImplementationOnce(async () => {
      directoryWhenStopping = await readdir(directory);
    });
    const finishing = host.finishAsync();
    expect(host.finishAsync()).toBe(finishing);
    await finishing;
    expect(uploads).toEqual([Buffer.from('manual-capture')]);
    expect(stopServer).toHaveBeenCalledTimes(1);
    expect(closeTunnel).toHaveBeenCalledTimes(1);
    // The collector finishes, and removes its directory, only after the host has stopped.
    expect(directoryWhenStopping).toBeDefined();
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  }
);

it.each([BuildRuntimePlatform.LINUX, BuildRuntimePlatform.DARWIN])(
  'refreshes the session preview of the ready device until the %s host finishes',
  async runtimePlatform => {
    const host = await startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform,
      env,
      logger,
      timeoutMs: 10_000,
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(startDeviceRunSessionPreview).toHaveBeenCalledTimes(1);
    expect(startDeviceRunSessionPreview).toHaveBeenCalledWith(
      expect.objectContaining({ deviceRunSessionId: 'drs-id', captureAsync: expect.any(Function) })
    );
    await host.finishAsync();
    expect(stopSessionPreview).toHaveBeenCalledTimes(1);
    expect(stopSessionPreview.mock.invocationCallOrder[0]).toBeLessThan(
      stopServer.mock.invocationCallOrder[0]
    );
  }
);

it.each(['success', 'failure'])(
  'keeps macOS readiness nonblocking and drains encoder setup %s before ending the phase',
  async result => {
    const install = deferred<void>();
    jest.mocked(ensureMacosPreviewEncoderInstalledAsync).mockReturnValueOnce(install.promise);
    const host = await startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
      separateLogPhase: true,
      timeoutMs: 10_000,
    });
    const setupLogger = jest.mocked(ensureMacosPreviewEncoderInstalledAsync).mock.calls[0][0]
      .logger;
    const finishing = host.finishAsync();
    expect(host.finishAsync()).toBe(finishing);
    try {
      await new Promise(resolve => setImmediate(resolve));
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ marker: LogMarker.END_PHASE }),
        expect.any(String)
      );
      expect(
        jest.mocked(ensureMacosPreviewEncoderInstalledAsync).mock.calls[0][0].signal?.aborted
      ).toBe(true);
      setupLogger.info('last encoder output');
      if (result === 'failure') {
        install.reject(new Error('encoder stopped'));
      } else {
        install.resolve();
      }
      await finishing;
      const calls = jest.mocked(logger.info).mock.calls;
      expect(calls.findIndex(([message]) => message === 'last encoder output')).toBeLessThan(
        calls.findIndex(([record]) => record?.marker === LogMarker.END_PHASE)
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        'Could not start refreshing the session preview.'
      );
      expect(startDeviceRunSessionPreview).not.toHaveBeenCalled();
      expect(stopServer).toHaveBeenCalledTimes(1);
    } finally {
      install.resolve();
      await finishing;
    }
  }
);

it('keeps the session running when encoder setup for the preview fails', async () => {
  jest
    .mocked(ensureMacosPreviewEncoderInstalledAsync)
    .mockRejectedValueOnce(new Error('brew failed'));
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    separateLogPhase: true,
    timeoutMs: 10_000,
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(startDeviceRunSessionPreview).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(
    { err: expect.objectContaining({ message: 'brew failed' }) },
    'Could not start refreshing the session preview.'
  );
  await host.finishAsync();
});

it('uses the existing step logger for startup and shutdown output', async () => {
  const host = await startHostAsync(false);
  const processLogger = jest.mocked(spawnDetached).mock.calls[0][0].logger;
  expect(processLogger).toBe(logger);
  stopServer.mockImplementationOnce(async () => processLogger?.info('last host output'));
  await host.finishAsync();
  expect(logger.info).toHaveBeenCalledWith('last host output');
  expect(
    jest
      .mocked(logger.info)
      .mock.calls.some(([record]) => typeof record === 'object' && 'marker' in record)
  ).toBe(false);
});

it('passes the active local-egress address to serve-sim without tunnel credentials', async () => {
  jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue({
    port: 8899,
    url: 'https://tunnel.example',
    token: 'tunnel-secret',
    fingerprint: 'fingerprint',
  });
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 10_000,
    networkCapture: true,
  });
  const spawned = jest.mocked(spawnDetached).mock.calls[0][0];
  expect(spawned.args).toEqual(
    expect.arrayContaining(['--network-capture-proxy', 'http://127.0.0.1:8899'])
  );
  expect(spawned.args).toContain('--network-capture');
  expect(JSON.stringify(spawned)).not.toContain('tunnel-secret');
  await host.finishAsync();
});

it('does not read the iOS egress handoff for an Android host', async () => {
  const host = await startHostAsync();
  expect(readLocalEgressHandoffAsync).not.toHaveBeenCalled();
  await host.finishAsync();
});

it.each([true, false])(
  'runs setup in parallel with app launch and readiness, then joins it at teardown (app: %s)',
  async hasApp => {
    const setup = deferred<void>();
    const prepared = deferred<ServeSimApplicationOptions | void>();
    const ready = deferred<Awaited<ReturnType<typeof turtleFetch>>>();
    jest.mocked(IosSimulatorUtils.disableApsdAsync).mockReturnValue(setup.promise);
    await mkdir('/tmp', { recursive: true });
    const directory = await import('node:fs/promises').then(fs =>
      fs.mkdtemp('/tmp/eas-staged-test-')
    );
    directories.push(directory);
    jest
      .mocked(stageServeSimAppAsync)
      .mockResolvedValue({ directory, path: `${directory}/App.app` });
    jest.mocked(spawnDetached).mockImplementation(options => {
      expect(options.env.TMPDIR).toBe(env.TMPDIR ?? require('node:os').tmpdir());
      expect(options.env.SERVE_SIM_STATE_DIR).toBe(
        env.SERVE_SIM_STATE_DIR ?? require('../serveSimMetricsRecorder').SERVE_SIM_STATE_DIR
      );
      expect(options.args).not.toContain('--startup-handoff');
      expect(options.args).not.toContain('--install-app-path');
      expect(options.args).not.toContain('--launch-app-identifier');
      const port = options.args[options.args.indexOf('--port') + 1];
      jest
        .mocked(readServeSimServersAsync)
        .mockResolvedValue([
          { udid: 'emulator-5554', token: 'preview-token', url: `http://127.0.0.1:${port}` },
        ]);
      return {
        pid: undefined,
        getOutput: () => '',
        getExitError: () => undefined,
        stopAsync: stopServer,
      };
    });
    jest.mocked(turtleFetch).mockImplementation(() => ready.promise);
    const starting = startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
      timeoutMs: 2_000,
      startupTimeoutMs: 120_000,
      iosSimulatorUdid: 'emulator-5554',
      application: prepared.promise,
    });
    while (!jest.mocked(IosSimulatorUtils.disableApsdAsync).mock.calls.length) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(turtleFetch).toHaveBeenCalled();
    expect(runServeSimActionAsync).not.toHaveBeenCalled();
    prepared.resolve(
      hasApp
        ? { installAppPath: '/tmp/App.app', launchAppIdentifier: 'dev.example.other' }
        : undefined
    );
    if (hasApp) {
      while (!jest.mocked(runServeSimActionAsync).mock.calls.length) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await new Promise(resolve => setImmediate(resolve));
      expect(runServeSimActionAsync).toHaveBeenCalledTimes(2);
    } else {
      expect(runServeSimActionAsync).not.toHaveBeenCalled();
    }
    expect(
      jest
        .mocked(runServeSimActionAsync)
        .mock.calls.map(([options]) => [options.action, options.params])
    ).toEqual(
      hasApp
        ? [
            ['app.install', { udid: 'emulator-5554', path: `${directory}/App.app` }],
            [
              'app.launch',
              {
                udid: 'emulator-5554',
                bundleId: 'dev.example.other',
                launchArgs: [],
                openUrl: undefined,
                restart: false,
              },
            ],
          ]
        : []
    );
    if (hasApp) {
      expect(runServeSimActionAsync).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'preview-token', timeoutMs: 120_000 })
      );
      expect(stageServeSimAppAsync).toHaveBeenCalledWith(
        '/tmp/App.app',
        env.TMPDIR ?? require('node:os').tmpdir()
      );
    }
    let queried = false;
    ready.resolve({
      ok: true,
      json: async () => {
        queried = true;
        return { status: 'ready', device: 'emulator-5554' };
      },
    } as never);
    let reported = false;
    void starting.then(() => {
      reported = true;
    });
    while (!queried) {
      await new Promise(resolve => setImmediate(resolve));
    }
    await new Promise(resolve => setImmediate(resolve));
    try {
      expect(reported).toBe(true);
      const host = await starting;
      let finished = false;
      const finishing = host.finishAsync().then(() => {
        finished = true;
      });
      await new Promise(resolve => setImmediate(resolve));
      expect(finished).toBe(false);
      setup.resolve();
      await finishing;
    } finally {
      setup.resolve();
      await (await starting).finishAsync();
    }
    if (hasApp) {
      await expect(access(directory)).rejects.toThrow();
    }
  }
);

it('stops the host without installing or launching when guard verification fails', async () => {
  jest
    .mocked(verifyLocalEgressGuardAsync)
    .mockRejectedValueOnce(new Error('guard refused startup'));
  jest.mocked(spawnDetached).mockImplementation(options => {
    const port = options.args[options.args.indexOf('--port') + 1];
    jest
      .mocked(readServeSimServersAsync)
      .mockResolvedValue([
        { udid: 'emulator-5554', token: 'preview-token', url: `http://127.0.0.1:${port}` },
      ]);
    return {
      pid: undefined,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopServer,
    };
  });
  await expect(
    startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
      timeoutMs: 2_000,
      iosSimulatorUdid: 'emulator-5554',
      bootEnv: { SERVE_SIM_ADDITIONAL_DYLIBS: '/guard.dylib' },
    })
  ).rejects.toThrow('guard refused startup');
  expect(runServeSimActionAsync).not.toHaveBeenCalled();
  expect(stopServer).toHaveBeenCalledTimes(1);
});

it('does not launch after installation fails', async () => {
  const setup = deferred<void>();
  jest.mocked(runServeSimActionAsync).mockRejectedValueOnce(new Error('install failed'));
  jest.mocked(IosSimulatorUtils.disableApsdAsync).mockReturnValue(setup.promise);
  jest.mocked(spawnDetached).mockImplementation(options => {
    const port = options.args[options.args.indexOf('--port') + 1];
    jest
      .mocked(readServeSimServersAsync)
      .mockResolvedValue([
        { udid: 'emulator-5554', token: 'preview-token', url: `http://127.0.0.1:${port}` },
      ]);
    return {
      pid: undefined,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopServer,
    };
  });
  await mkdir('/tmp', { recursive: true });
  const directory = await import('node:fs/promises').then(fs =>
    fs.mkdtemp('/tmp/eas-staged-test-')
  );
  directories.push(directory);
  jest.mocked(stageServeSimAppAsync).mockResolvedValue({ directory, path: `${directory}/App.app` });
  const starting = startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 2_000,
    iosSimulatorUdid: 'emulator-5554',
    installAppPath: '/tmp/App.app',
    launchAppIdentifier: 'dev.example.app',
  });
  const rejected = expect(starting).rejects.toThrow('install failed');
  while (!stopServer.mock.calls.length) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await access(directory);
  let settled = false;
  void starting.catch(() => {
    settled = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(settled).toBe(false);
  setup.resolve();
  await rejected;
  expect(runServeSimActionAsync).toHaveBeenCalledTimes(1);
  expect(stopServer).toHaveBeenCalledTimes(1);
  await expect(access(directory)).rejects.toThrow();
});

it('verifies the guard before starting setup or installing the app', async () => {
  const guard = deferred<void>();
  jest.mocked(verifyLocalEgressGuardAsync).mockReturnValue(guard.promise);
  jest
    .mocked(stageServeSimAppAsync)
    .mockResolvedValue({ directory: '/staged', path: '/staged/App.app' });
  const starting = startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 2_000,
    iosSimulatorUdid: 'emulator-5554',
    bootEnv: { SERVE_SIM_ADDITIONAL_DYLIBS: '/guard.dylib' },
    installAppPath: '/tmp/App.app',
    launchAppIdentifier: 'dev.example.app',
  });
  while (!jest.mocked(verifyLocalEgressGuardAsync).mock.calls.length) {
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(verifyLocalEgressGuardAsync).toHaveBeenCalledWith({
    udid: 'emulator-5554',
    env,
    logger,
  });
  expect(IosSimulatorUtils.disableApsdAsync).not.toHaveBeenCalled();
  expect(runServeSimActionAsync).not.toHaveBeenCalled();
  guard.resolve();
  const host = await starting;
  expect(IosSimulatorUtils.disableApsdAsync).toHaveBeenCalledWith({
    udid: 'emulator-5554',
    env,
  });
  expect(runServeSimActionAsync).toHaveBeenCalledTimes(2);
  await host.finishAsync();
});

it('warns and continues launching when disabling push fails', async () => {
  const error = new Error('apsd disable failed');
  jest.mocked(IosSimulatorUtils.disableApsdAsync).mockRejectedValueOnce(error);
  const host = await startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 2_000,
    iosSimulatorUdid: 'emulator-5554',
    launchAppIdentifier: 'dev.example.app',
  });
  expect(logger.warn).toHaveBeenCalledWith(
    { err: error },
    'Failed to disable apsd in the Simulator.'
  );
  expect(runServeSimActionAsync).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'app.launch' })
  );
  expect(IosSimulatorUtils.waitForReadyAsync).not.toHaveBeenCalled();
  await host.finishAsync();
});

it('cancels pending app preparation and observes late setup failure', async () => {
  const application = deferred<ServeSimApplicationOptions>();
  const controller = new AbortController();
  let rejectSetup!: (error: Error) => void;
  jest.mocked(IosSimulatorUtils.disableApsdAsync).mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectSetup = reject;
    })
  );
  const starting = startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 2_000,
    iosSimulatorUdid: 'emulator-5554',
    application: application.promise,
    signal: controller.signal,
  });
  const rejected = expect(starting).rejects.toThrow('session canceled');
  while (!jest.mocked(IosSimulatorUtils.disableApsdAsync).mock.calls.length) {
    await new Promise(resolve => setImmediate(resolve));
  }
  controller.abort(new Error('session canceled'));
  await rejected;
  expect(runServeSimActionAsync).not.toHaveBeenCalled();
  expect(stopServer).toHaveBeenCalledTimes(1);
  rejectSetup(new Error('late setup failure'));
  await new Promise(resolve => setImmediate(resolve));
});

it('cancels a pending guard check before setup or app startup', async () => {
  const controller = new AbortController();
  let rejectGuard!: (error: Error) => void;
  jest.mocked(verifyLocalEgressGuardAsync).mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectGuard = reject;
    })
  );
  const starting = startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 2_000,
    iosSimulatorUdid: 'emulator-5554',
    bootEnv: { SERVE_SIM_ADDITIONAL_DYLIBS: '/guard.dylib' },
    installAppPath: '/tmp/App.app',
    launchAppIdentifier: 'dev.example.app',
    signal: controller.signal,
  });
  const rejected = expect(starting).rejects.toThrow('session canceled');
  while (!jest.mocked(verifyLocalEgressGuardAsync).mock.calls.length) {
    await new Promise(resolve => setImmediate(resolve));
  }
  controller.abort(new Error('session canceled'));
  await rejected;
  expect(IosSimulatorUtils.disableApsdAsync).not.toHaveBeenCalled();
  expect(runServeSimActionAsync).not.toHaveBeenCalled();
  expect(stopServer).toHaveBeenCalledTimes(1);
  rejectGuard(new Error('late guard failure'));
  await new Promise(resolve => setImmediate(resolve));
});

it('cancels setup while the app download is still pending', async () => {
  const controller = new AbortController();
  const application = deferred<ServeSimApplicationOptions>();
  jest.mocked(IosSimulatorUtils.disableApsdAsync).mockImplementationOnce(async () => {
    controller.abort(new Error('session canceled'));
  });
  await expect(
    startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
      timeoutMs: 2_000,
      iosSimulatorUdid: 'emulator-5554',
      application: application.promise,
      signal: controller.signal,
    })
  ).rejects.toThrow('session canceled');
  expect(runServeSimActionAsync).not.toHaveBeenCalled();
  expect(stopServer).toHaveBeenCalledTimes(1);
});

it('reports startup failure before waiting for host cleanup', async () => {
  const failure = new Error('guard refused startup');
  const stopping = deferred<void>();
  const onStartupError = jest.fn();
  jest.mocked(verifyLocalEgressGuardAsync).mockRejectedValueOnce(failure);
  stopServer.mockImplementationOnce(() => stopping.promise);
  const starting = startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 2_000,
    iosSimulatorUdid: 'emulator-5554',
    bootEnv: { SERVE_SIM_ADDITIONAL_DYLIBS: '/guard.dylib' },
    onStartupError,
  });
  const rejected = expect(starting).rejects.toBe(failure);
  while (!stopServer.mock.calls.length) {
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(onStartupError).toHaveBeenCalledTimes(1);
  expect(onStartupError).toHaveBeenCalledWith(failure);
  expect(runServeSimActionAsync).not.toHaveBeenCalled();
  stopping.resolve();
  await rejected;
});

it.each(['control state', 'app download'])(
  'stops owned startup when readiness fails while waiting for %s',
  async waitingFor => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const controller = new AbortController();
    const application = deferred<ServeSimApplicationOptions>();
    const onStartupError = jest.fn();
    jest.mocked(turtleFetch).mockResolvedValue({ ok: false, status: 503 } as never);
    if (waitingFor === 'control state') {
      jest.mocked(spawnDetached).mockReturnValueOnce({
        pid: undefined,
        getOutput: () => '',
        getExitError: () => undefined,
        stopAsync: stopServer,
      });
      jest.mocked(readServeSimServersAsync).mockResolvedValue([]);
    }
    const starting = startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
      timeoutMs: 1_000,
      iosSimulatorUdid: 'emulator-5554',
      application: waitingFor === 'app download' ? application.promise : undefined,
      signal: controller.signal,
      onStartupError,
    });
    const outcome = starting.catch(error => error);
    try {
      while (!jest.mocked(turtleFetch).mock.calls.length) {
        await new Promise(resolve => setImmediate(resolve));
      }
      await jest.advanceTimersByTimeAsync(2_000);
      expect(onStartupError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('readiness returned HTTP 503'),
        })
      );
      expect(stopServer).toHaveBeenCalledTimes(1);
      expect(runServeSimActionAsync).not.toHaveBeenCalled();
    } finally {
      controller.abort(new Error('test cleanup'));
      await jest.advanceTimersByTimeAsync(1_000);
      await outcome;
    }
  }
);

it('cancels an in-flight install while Simulator setup is pending', async () => {
  const controller = new AbortController();
  const failure = new Error('session canceled');
  let rejectSetup!: (error: Error) => void;
  const setup = new Promise<void>((_resolve, reject) => {
    rejectSetup = reject;
  });
  jest.mocked(IosSimulatorUtils.disableApsdAsync).mockReturnValue(setup);
  jest
    .mocked(stageServeSimAppAsync)
    .mockResolvedValue({ directory: '/staged', path: '/staged/App.app' });
  let installSignal: AbortSignal | undefined;
  jest.mocked(runServeSimActionAsync).mockImplementationOnce(async options => {
    installSignal = options.signal;
    await new Promise<void>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
        once: true,
      });
    });
  });
  const starting = startDeviceSessionHostAsync(ctx, {
    preview: { baseDomain, authtoken },
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    timeoutMs: 2_000,
    iosSimulatorUdid: 'emulator-5554',
    installAppPath: '/tmp/App.app',
    launchAppIdentifier: 'dev.example.app',
    signal: controller.signal,
  });
  const rejected = expect(starting).rejects.toBe(failure);
  while (!jest.mocked(runServeSimActionAsync).mock.calls.length) {
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(installSignal?.aborted).toBe(false);
  controller.abort(failure);
  await rejected;
  rejectSetup(new Error('late setup failure'));
  await new Promise(resolve => setImmediate(resolve));
  expect(installSignal?.aborted).toBe(true);
  expect(installSignal?.reason).toBe(failure);
  expect(runServeSimActionAsync).toHaveBeenCalledTimes(1);
  expect(stopServer).toHaveBeenCalledTimes(1);
});

it('redacts bearer tokens from preview readiness diagnostics while preserving the failure', async () => {
  const output = [
    'Native addon failed to initialize',
    'Local: http://localhost:1234/?token=private-token&mode=preview',
    'Share: https://expo.dev/simulator-preview/abc#token=fragment-secret',
    '{"url":"http://localhost:1234/","token":"quiet-secret"}',
  ].join('\n');
  const readiness = waitForWebPreviewReadyAsync({
    previewServer: { pid: undefined, getOutput: () => output },
    serverName: 'serve-sim',
    port: 1234,
    timeoutMs: 0,
  });
  await expect(readiness).rejects.toThrow('Timed out waiting for serve-sim readiness');
  await expect(readiness).rejects.toThrow('Native addon failed to initialize');
  await expect(readiness).rejects.toThrow('?token=[redacted]&mode=preview');
  for (const secret of ['private-token', 'fragment-secret', 'quiet-secret']) {
    await expect(readiness).rejects.not.toThrow(secret);
  }
});

it.each([BuildRuntimePlatform.LINUX, BuildRuntimePlatform.DARWIN])(
  'keeps cold %s startup waiting for TURN before starting collectors',
  async runtimePlatform => {
    const turn = deferred<string[]>();
    const screenshots = jest.spyOn(screenshotCollector, 'startDeviceRunSessionScreenshotsAsync');
    jest.mocked(fetchWebPreviewTurnArgsAsync).mockReturnValueOnce(turn.promise);
    const starting = startDeviceSessionHostAsync(ctx, {
      preview: { baseDomain, authtoken },
      runtimePlatform,
      env,
      logger,
      timeoutMs: 10_000,
    });
    let host: Awaited<typeof starting> | undefined;
    try {
      for (let i = 0; i < 50 && !jest.mocked(fetchWebPreviewTurnArgsAsync).mock.calls.length; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(fetchWebPreviewTurnArgsAsync).toHaveBeenCalledTimes(1);
      expect(screenshots).not.toHaveBeenCalled();
      turn.resolve([]);
      host = await starting;
      expect(screenshots).toHaveBeenCalledTimes(1);
    } finally {
      turn.resolve([]);
      host ??= await starting;
      await host.finishAsync();
      screenshots.mockRestore();
    }
  }
);

it.each([false, true])(
  'waits for a supplied server to stop after startup fails (cleanupFails=%s)',
  async cleanupFails => {
    const startupError = new Error('Server handshake failed after starting.');
    const cleanupError = new Error('Server could not be stopped.');
    const stopped = deferred<void>();
    const finishScreenshots = jest.fn().mockResolvedValue(undefined);
    const screenshots = jest
      .spyOn(screenshotCollector, 'startDeviceRunSessionScreenshotsAsync')
      .mockResolvedValueOnce({ directory: '/mock/screenshots', finishAsync: finishScreenshots });
    const stopAsync = jest.fn(() => stopped.promise);
    const server = {
      port: 3200,
      turnArgs: Promise.resolve([]),
      requiresPreviewRetirement: false,
      async startAsync() {
        throw startupError;
      },
      stopAsync,
    };
    const options = {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
      timeoutMs: 1000,
    };
    const finished = jest.fn();
    const outcome = startDeviceSessionHostAsync(ctx, options, server).catch(error => {
      finished();
      return error;
    });
    try {
      for (let i = 0; i < 50 && !stopAsync.mock.calls.length; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(stopAsync).toHaveBeenCalledTimes(1);
      expect(finishScreenshots).not.toHaveBeenCalled();
      expect(finished).not.toHaveBeenCalled();
      if (cleanupFails) {
        stopped.reject(cleanupError);
      } else {
        stopped.resolve();
      }
      expect(await outcome).toBe(startupError);
      expect(finishScreenshots).toHaveBeenCalledTimes(1);
      expect(finishScreenshots).toHaveBeenCalledWith(!cleanupFails);
      if (cleanupFails) {
        expect(logger.warn).toHaveBeenCalledWith(
          { err: cleanupError },
          'Could not stop the session server after startup failed.'
        );
      }
    } finally {
      stopped.resolve();
      await outcome;
      screenshots.mockRestore();
    }
  }
);

it('opens the preview while a supplied server waits for TURN and its startup handshake', async () => {
  const turn = deferred<string[]>();
  const handshake = deferred<Awaited<ReturnType<typeof spawnDetached>>>();
  const startAsync = jest.fn(() => handshake.promise);
  const server = {
    port: 3200,
    turnArgs: turn.promise,
    requiresPreviewRetirement: true,
    startAsync,
    stopAsync: stopServer,
  };
  jest
    .mocked(readServeSimServersAsync)
    .mockResolvedValue([
      { udid: 'emulator-5554', token: 'preview-token', url: 'http://127.0.0.1:3200' },
    ]);
  const starting = startDeviceSessionHostAsync(
    ctx,
    {
      preview: { baseDomain, authtoken },
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env,
      logger,
      iosSimulatorUdid: 'emulator-5554',
      launchAppIdentifier: 'test.application',
      timeoutMs: 1000,
    },
    server
  );
  let host: Awaited<typeof starting> | undefined;
  const handle = {
    pid: undefined,
    getOutput: () => '',
    getExitError: () => undefined,
    stopAsync: stopServer,
  };
  try {
    for (let i = 0; i < 50 && !jest.mocked(ngrok.forward).mock.calls.length; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(ngrok.forward).toHaveBeenCalledTimes(1);
    expect(startAsync).not.toHaveBeenCalled();
    turn.resolve([]);
    for (let i = 0; i < 50 && !startAsync.mock.calls.length; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(startAsync).toHaveBeenCalledTimes(1);
    expect(runServeSimActionAsync).not.toHaveBeenCalled();
    handshake.resolve(handle);
    host = await starting;
    expect(runServeSimActionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app.launch' })
    );
    expect(IosSimulatorUtils.disableApsdAsync).not.toHaveBeenCalled();
    expect(fetchWebPreviewTurnArgsAsync).not.toHaveBeenCalled();
  } finally {
    turn.resolve([]);
    handshake.resolve(handle);
    host ??= await starting;
    await host.finishAsync();
  }
});

it.each(['opened', 'late'])(
  'rejects failed startup when the %s preview tunnel cannot be retired',
  async timing => {
    const tunnel = deferred<Awaited<ReturnType<typeof ngrok.forward>>>();
    const startup = deferred<Awaited<ReturnType<typeof spawnDetached>>>();
    const startupError = new Error('Server handshake failed.');
    const closeError = new Error('Preview listener is still running.');
    const startAsync = jest.fn(() => startup.promise);
    const finishScreenshots = jest.fn().mockResolvedValue(undefined);
    const screenshots = jest
      .spyOn(screenshotCollector, 'startDeviceRunSessionScreenshotsAsync')
      .mockResolvedValueOnce({ directory: '/mock/screenshots', finishAsync: finishScreenshots });
    jest.mocked(ngrok.forward).mockReturnValueOnce(tunnel.promise);
    closeTunnel.mockRejectedValueOnce(closeError);
    const server = {
      port: 3200,
      turnArgs: Promise.resolve([]),
      requiresPreviewRetirement: true,
      startAsync,
      stopAsync: stopServer,
    };
    const starting = startDeviceSessionHostAsync(
      ctx,
      {
        preview: { baseDomain, authtoken },
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        env,
        logger,
        timeoutMs: 1000,
      },
      server
    );
    const outcome = starting.catch(error => error);
    try {
      if (timing === 'opened') {
        tunnel.resolve({ url: () => 'https://open.example.test', close: closeTunnel } as never);
      }
      for (let i = 0; i < 50 && !startAsync.mock.calls.length; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(startAsync).toHaveBeenCalledTimes(1);
      startup.reject(startupError);
      await new Promise(resolve => setImmediate(resolve));
      if (timing === 'late') {
        expect(stopServer).not.toHaveBeenCalled();
        tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
      }
      const error = await outcome;
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors).toContain(startupError);
      expect(error.errors).toContain(closeError);
      expect(stopServer).toHaveBeenCalledTimes(1);
      expect(finishScreenshots).toHaveBeenCalledWith(true);
      expect(runServeSimActionAsync).not.toHaveBeenCalled();
    } finally {
      startup.reject(startupError);
      tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
      await outcome;
      screenshots.mockRestore();
    }
  }
);

it.each(['startup failure', 'cancellation', 'opening timeout'])(
  'bounds cleanup after %s while preview opening stays pending, then closes its late listener',
  async failure => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const tunnel = deferred<Awaited<ReturnType<typeof ngrok.forward>>>();
    const controller = new AbortController();
    const startupError = new Error(failure);
    const finishScreenshots = jest.fn().mockResolvedValue(undefined);
    const screenshots = jest
      .spyOn(screenshotCollector, 'startDeviceRunSessionScreenshotsAsync')
      .mockResolvedValueOnce({ directory: '/mock/screenshots', finishAsync: finishScreenshots });
    jest.mocked(ngrok.forward).mockReturnValueOnce(tunnel.promise);
    const startAsync = jest.fn(async () => {
      if (failure === 'startup failure') {
        throw startupError;
      }
      return {
        pid: undefined,
        getOutput: () => '',
        getExitError: () => undefined,
        stopAsync: stopServer,
      };
    });
    const outcome = startDeviceSessionHostAsync(
      ctx,
      {
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        preview: { baseDomain, authtoken },
        env,
        logger,
        timeoutMs: 1000,
        signal: controller.signal,
      },
      {
        port: 3200,
        turnArgs: Promise.resolve([]),
        requiresPreviewRetirement: true,
        startAsync,
        stopAsync: stopServer,
      }
    ).catch(error => error);
    try {
      for (let i = 0; i < 50 && !startAsync.mock.calls.length; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(startAsync).toHaveBeenCalledTimes(1);
      if (failure !== 'startup failure') {
        for (
          let i = 0;
          i < 50 && !jest.mocked(startDeviceRunSessionPreview).mock.calls.length;
          i++
        ) {
          await new Promise(resolve => setImmediate(resolve));
        }
        expect(startDeviceRunSessionPreview).toHaveBeenCalledTimes(1);
        if (failure === 'cancellation') {
          controller.abort(startupError);
        } else {
          await jest.advanceTimersByTimeAsync(1000);
        }
      }
      await jest.advanceTimersByTimeAsync(4_999);
      expect(stopServer).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      const error = await outcome;
      expect(error).toBeInstanceOf(AggregateError);
      if (failure === 'opening timeout') {
        expect(error.errors[0].message).toContain('Preview tunnel opening timed out');
      } else {
        expect(error.errors).toContain(startupError);
      }
      expect(stopServer).toHaveBeenCalledTimes(1);
      expect(finishScreenshots).toHaveBeenCalledWith(true);
      expect(closeTunnel).not.toHaveBeenCalled();
      tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
      await new Promise(resolve => setImmediate(resolve));
      expect(closeTunnel).toHaveBeenCalledTimes(1);
    } finally {
      tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
      await jest.advanceTimersByTimeAsync(10_000);
      await outcome;
      screenshots.mockRestore();
    }
  }
);

it.each([
  { action: 'app.install', tunnelTiming: 'opened' },
  { action: 'app.launch', tunnelTiming: 'late' },
])(
  'preserves $action failure when the $tunnelTiming preview tunnel cannot close',
  async ({ action, tunnelTiming }) => {
    const startupError = new Error(`${action} failed.`);
    const cleanupError = new Error('Preview listener could not close.');
    const tunnel = deferred<Awaited<ReturnType<typeof ngrok.forward>>>();
    const closing = deferred<void>();
    const stopped = jest.fn().mockResolvedValue(undefined);
    const finishScreenshots = jest.fn().mockResolvedValue(undefined);
    const screenshots = jest
      .spyOn(screenshotCollector, 'startDeviceRunSessionScreenshotsAsync')
      .mockResolvedValueOnce({ directory: '/mock/screenshots', finishAsync: finishScreenshots });
    jest.mocked(ngrok.forward).mockReturnValueOnce(tunnel.promise);
    closeTunnel.mockReturnValueOnce(closing.promise);
    jest
      .mocked(readServeSimServersAsync)
      .mockResolvedValue([
        { udid: 'emulator-5554', token: 'preview-token', url: 'http://127.0.0.1:3200' },
      ]);
    jest.mocked(stageServeSimAppAsync).mockResolvedValueOnce({
      directory: '/mock/staged',
      path: '/mock/staged/Application.app',
    });
    jest
      .mocked(runServeSimActionAsync)
      .mockReset()
      .mockImplementation(async options => {
        if (options.action === action) {
          throw startupError;
        }
        return { ok: true } as never;
      });
    const server = {
      port: 3200,
      turnArgs: Promise.resolve([]),
      requiresPreviewRetirement: true,
      async startAsync() {
        return {
          pid: undefined,
          getOutput: () => '',
          getExitError: () => undefined,
          stopAsync: stopped,
        };
      },
      stopAsync: stopped,
    };
    const onStartupError = jest.fn();
    const finished = jest.fn();
    const outcome = startDeviceSessionHostAsync(
      ctx,
      {
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        preview: { baseDomain, authtoken },
        env,
        logger,
        timeoutMs: 1000,
        iosSimulatorUdid: 'emulator-5554',
        installAppPath: '/artifacts/Application.app',
        launchAppIdentifier: 'test.application',
        onStartupError,
      },
      server
    ).catch(error => {
      finished();
      return error;
    });
    try {
      if (tunnelTiming === 'opened') {
        tunnel.resolve({ url: () => 'https://open.example.test', close: closeTunnel } as never);
      }
      for (let i = 0; i < 50 && !onStartupError.mock.calls.length; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(onStartupError).toHaveBeenCalledWith(startupError);
      if (tunnelTiming === 'late') {
        expect(stopped).not.toHaveBeenCalled();
        tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
      }
      for (let i = 0; i < 50 && !closeTunnel.mock.calls.length; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(closeTunnel).toHaveBeenCalledTimes(1);
      expect(finished).not.toHaveBeenCalled();
      expect(stopped).not.toHaveBeenCalled();
      closing.reject(cleanupError);
      const error = await outcome;
      expect(error.constructor).toBe(AggregateError);
      expect(error.errors).toContain(startupError);
      expect(error.errors[1]).toBeInstanceOf(AggregateError);
      expect(error.errors[1].errors).toContain(cleanupError);
      expect(error.name).not.toBe('WarmSessionAdoptionError');
      expect(stopped).toHaveBeenCalledTimes(1);
      expect(finishScreenshots).toHaveBeenCalledWith(true);
      expect(stopped.mock.invocationCallOrder[0]).toBeLessThan(
        finishScreenshots.mock.invocationCallOrder[0]
      );
    } finally {
      tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
      closing.reject(cleanupError);
      await outcome;
      screenshots.mockRestore();
    }
  }
);
