import { BuildPhase, BuildPhaseResult, LogMarker } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import * as ngrok from '@ngrok/ngrok';
import { access, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { turtleFetch } from '../../../utils/turtleFetch';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import {
  findUnlistedDeviceScreenRecordingsAsync,
  uploadDeviceRunSessionScreenRecordingsAsync,
} from '../deviceRunSessionScreenRecordings';
import {
  ensureMacosPreviewEncoderInstalledAsync,
  startDeviceRunSessionPreview,
} from '../deviceRunSessionPreview';
import { startDeviceSessionHostAsync } from '../deviceSessionHost';
import {
  ensureFfmpegInstalledOnceAsync,
  fetchWebPreviewTurnArgsAsync,
  spawnDetached,
} from '../remoteDeviceRunSession';
import * as screenshotCollector from '../deviceRunSessionScreenshots';

jest.mock('@ngrok/ngrok');
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
  startDeviceRunSessionPreview: jest.fn(),
}));
jest.mock('../deviceRunSessionScreenRecordings', () => ({
  ...jest.requireActual('../deviceRunSessionScreenRecordings'),
  findUnlistedDeviceScreenRecordingsAsync: jest.fn(),
  uploadDeviceRunSessionScreenRecordingsAsync: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const env = {
  DEVICE_RUN_SESSION_ID: 'drs-id',
  NGROK_AUTHTOKEN: 'token',
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
const baseDomain = 'preview.example.test';

async function startHostAsync(separateLogPhase = true) {
  return await startDeviceSessionHostAsync(ctx, {
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
  stopSessionPreview.mockResolvedValue(undefined);
  jest.mocked(startDeviceRunSessionPreview).mockReturnValue({ stopAsync: stopSessionPreview });
  jest.mocked(ensureFfmpegInstalledOnceAsync).mockResolvedValue(undefined);
  jest.mocked(ensureMacosPreviewEncoderInstalledAsync).mockResolvedValue(undefined);
  stopServer.mockResolvedValue(undefined);
  closeTunnel.mockResolvedValue(undefined);
  jest.mocked(uploadDeviceRunSessionScreenRecordingsAsync).mockReset().mockResolvedValue(false);
  jest.mocked(findUnlistedDeviceScreenRecordingsAsync).mockReset().mockResolvedValue([]);
  jest.mocked(spawnDetached).mockImplementation(options => {
    const flag = options.args.indexOf('--android-recording-directory');
    if (flag >= 0) {
      directories.push(options.args[flag + 1]);
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
    directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))
  );
});

it('records by default with no preview and finalizes before process stop, uploading exactly once', async () => {
  const host = await startHostAsync();
  expect(ngrok.forward).not.toHaveBeenCalled();
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
  await expect(host.openPreviewAsync({ baseDomain })).rejects.toThrow(
    'after session host finalization'
  );
});

it('coalesces preview opens and allows close/reopen without ending capture', async () => {
  const host = await startHostAsync();
  const opening = host.openPreviewAsync({ baseDomain });
  expect(host.openPreviewAsync({ baseDomain })).toBe(opening);
  const first = await opening;
  const closing = first.closeAsync();
  expect(first.closeAsync()).toBe(closing);
  await closing;
  const secondClose = jest.fn().mockResolvedValue(undefined);
  jest.mocked(ngrok.forward).mockResolvedValueOnce({
    url: () => 'https://replacement.example.test',
    close: secondClose,
  } as never);
  const second = await host.openPreviewAsync({ baseDomain });
  await first.closeAsync();
  expect(await host.openPreviewAsync({ baseDomain })).toBe(second);
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

it('retries a failed tunnel without restarting the host', async () => {
  const host = await startHostAsync();
  jest.mocked(ngrok.forward).mockRejectedValueOnce(new Error('tunnel unavailable'));
  await expect(host.openPreviewAsync({ baseDomain })).rejects.toThrow('tunnel unavailable');
  expect(stopServer).not.toHaveBeenCalled();
  await host.openPreviewAsync({ baseDomain });
  expect(spawnDetached).toHaveBeenCalledTimes(1);
  await host.finishAsync();
  expect(closeTunnel).toHaveBeenCalledTimes(1);
});

it('drains an in-flight tunnel when finishing and rejects new opens', async () => {
  const host = await startHostAsync();
  const tunnel = deferred<Awaited<ReturnType<typeof ngrok.forward>>>();
  jest.mocked(ngrok.forward).mockReturnValueOnce(tunnel.promise);
  const opening = host.openPreviewAsync({ baseDomain });
  const finishing = host.finishAsync();
  await expect(host.openPreviewAsync({ baseDomain })).rejects.toThrow(
    'after session host finalization'
  );
  tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
  await expect(opening).rejects.toThrow('finalized while the preview was opening');
  await finishing;
  expect(closeTunnel).toHaveBeenCalledTimes(1);
  expect(stopServer).toHaveBeenCalledTimes(1);
});

it('keeps cleanup and upload best-effort when tunnel close and finalization fail', async () => {
  jest.mocked(spawnDetached).mockImplementationOnce(options => {
    directories.push(options.args[options.args.indexOf('--android-recording-directory') + 1]);
    return {
      pid: undefined,
      getOutput: () => '[serve-emu] emulator-5554 capture error: scrcpy exited with code 255',
      getExitError: () => undefined,
      stopAsync: stopServer,
    };
  });
  const host = await startHostAsync();
  await writeFile(path.join(directories[0], 'recordings.json'), '[]');
  await host.openPreviewAsync({ baseDomain });
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
  expect(ngrok.forward).not.toHaveBeenCalled();
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
  await host.openPreviewAsync({ baseDomain });
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
  const tunnel = deferred<Awaited<ReturnType<typeof ngrok.forward>>>();
  jest.mocked(ngrok.forward).mockReturnValueOnce(tunnel.promise);
  const opening = host.openPreviewAsync({ baseDomain });
  const rejected = expect(opening).rejects.toThrow('finalized while the preview was opening');
  jest.useFakeTimers();
  const finishing = host.finishAsync();
  await jest.advanceTimersByTimeAsync(5_000);
  await finishing;
  expect(stopServer).toHaveBeenCalledTimes(1);
  tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
  await rejected;
  expect(closeTunnel).toHaveBeenCalledTimes(1);
});

it('leaves iOS recording to its existing build steps', async () => {
  const host = await startDeviceSessionHostAsync(ctx, {
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

it('passes the TURN credential and the Android control token to the host as secrets', async () => {
  jest.mocked(fetchWebPreviewTurnArgsAsync).mockResolvedValueOnce(turnArgs);
  const host = await startHostAsync();
  const options = jest.mocked(spawnDetached).mock.calls[0][0];
  const controlToken = options.env.EXPO_DEVICE_HUB_RECORDING_CONTROL_TOKEN;
  expect(controlToken).toMatch(/^[a-f0-9]{64}$/);
  expect(options.secrets).toEqual(['turn-secret', controlToken]);
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
  expect((await host.openPreviewAsync({ baseDomain })).previewToken).toBe('preview-token');
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
  await host.openPreviewAsync({ baseDomain });
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
  await host.openPreviewAsync({ baseDomain });
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

it('ends the preview phase with failure if opening the tunnel fails', async () => {
  const host = await startHostAsync();
  jest.mocked(ngrok.forward).mockRejectedValueOnce(new Error('tunnel unavailable'));
  await expect(host.openPreviewAsync({ baseDomain })).rejects.toThrow('tunnel unavailable');
  await host.finishAsync();
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
      .mockImplementation(async (_ctx, { stream }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        uploads.push(Buffer.concat(chunks));
      });
    const host = await startDeviceSessionHostAsync(ctx, {
      runtimePlatform,
      env,
      logger,
      timeoutMs: 10_000,
    });
    await host.openPreviewAsync({ baseDomain });
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

it('does not delay macOS readiness on encoder setup or start the preview after finish', async () => {
  const install = deferred<void>();
  jest.mocked(ensureMacosPreviewEncoderInstalledAsync).mockReturnValueOnce(install.promise);
  const host = await startDeviceSessionHostAsync(ctx, {
    runtimePlatform: BuildRuntimePlatform.DARWIN,
    env,
    logger,
    separateLogPhase: true,
    timeoutMs: 10_000,
  });
  await host.finishAsync();
  install.resolve();
  await new Promise(resolve => setImmediate(resolve));
  expect(startDeviceRunSessionPreview).not.toHaveBeenCalled();
  expect(stopServer).toHaveBeenCalledTimes(1);
});

it('keeps the session running when encoder setup for the preview fails', async () => {
  jest
    .mocked(ensureMacosPreviewEncoderInstalledAsync)
    .mockRejectedValueOnce(new Error('brew failed'));
  const host = await startDeviceSessionHostAsync(ctx, {
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
