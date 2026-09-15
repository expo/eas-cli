import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import * as ngrok from '@ngrok/ngrok';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CustomBuildContext } from '../../../customBuildContext';
import { turtleFetch } from '../../../utils/turtleFetch';
import { uploadDeviceRunSessionScreenRecordingsAsync } from '../deviceRunSessionScreenRecordings';
import { startDeviceSessionHostAsync } from '../deviceSessionHost';
import { spawnDetached } from '../remoteDeviceRunSession';

jest.mock('@ngrok/ngrok');
jest.mock('../../../utils/turtleFetch');
jest.mock('../remoteDeviceRunSession', () => ({
  ...jest.requireActual('../remoteDeviceRunSession'),
  ensureFfmpegInstalledOnceAsync: jest.fn(),
  fetchWebPreviewTurnArgsAsync: jest.fn().mockResolvedValue([]),
  spawnDetached: jest.fn(),
}));
jest.mock('../deviceRunSessionScreenRecordings', () => ({
  ...jest.requireActual('../deviceRunSessionScreenRecordings'),
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
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const stopServer = jest.fn();
const closeTunnel = jest.fn();
const directories: string[] = [];
const baseDomain = 'preview.example.test';

async function startHostAsync() {
  return await startDeviceSessionHostAsync(ctx, {
    runtimePlatform: BuildRuntimePlatform.LINUX,
    env,
    logger,
    timeoutMs: 10_000,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  stopServer.mockResolvedValue(undefined);
  closeTunnel.mockResolvedValue(undefined);
  jest.mocked(uploadDeviceRunSessionScreenRecordingsAsync).mockReset().mockResolvedValue(false);
  jest.mocked(spawnDetached).mockImplementation(options => {
    const flag = options.args.indexOf('--android-recording-directory');
    if (flag >= 0) {
      directories.push(options.args[flag + 1]);
    }
    return { pid: undefined, getOutput: () => '', stopAsync: stopServer };
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

it('records with no preview and finalizes before process stop, uploading exactly once', async () => {
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
      timeout: 60_000,
      retries: 0,
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
    signal: expect.any(AbortSignal),
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
  const host = await startHostAsync();
  await writeFile(path.join(directories[0], 'recordings.json'), '[]');
  await host.openPreviewAsync({ baseDomain });
  closeTunnel.mockRejectedValueOnce(new Error('tunnel close failure'));
  jest
    .mocked(turtleFetch)
    .mockResolvedValueOnce({ ok: false, status: 500 } as Awaited<ReturnType<typeof turtleFetch>>);
  await host.finishAsync();
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.anything(),
    'Could not finalize Android recording before shutdown.'
  );
  expect(uploadDeviceRunSessionScreenRecordingsAsync).toHaveBeenCalledTimes(1);
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
  expect(ngrok.forward).not.toHaveBeenCalled();
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
  const host = await startHostAsync(false);
  await host.openPreviewAsync({ baseDomain });
  const closing = deferred<void>();
  closeTunnel.mockReturnValueOnce(closing.promise);
  jest.useFakeTimers();
  const finishing = host.finishAsync();
  await jest.advanceTimersByTimeAsync(5_000);
  await finishing;
  expect(stopServer).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('deadline'));
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

it('retains files when an upload resolves after its deadline', async () => {
  const host = await startHostAsync();
  const directory = directories[0];
  await writeRecordingDescriptorAsync(directory);
  const started = deferred<void>();
  const upload = deferred<boolean>();
  jest.mocked(uploadDeviceRunSessionScreenRecordingsAsync).mockImplementationOnce(async () => {
    started.resolve();
    return await upload.promise;
  });
  jest.useFakeTimers();
  const finishing = host.finishAsync();
  await started.promise;
  await jest.advanceTimersByTimeAsync(305_000);
  await finishing;
  expect(
    jest.mocked(uploadDeviceRunSessionScreenRecordingsAsync).mock.calls[0][1].signal?.aborted
  ).toBe(true);
  upload.resolve(true);
  await jest.advanceTimersByTimeAsync(0);
  await expect(access(directory)).resolves.toBeUndefined();
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
  const host = await startHostAsync(false);
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
