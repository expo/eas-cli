import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import * as ngrok from '@ngrok/ngrok';
import { rm, writeFile } from 'node:fs/promises';
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
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true })));
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
  expect(stopServer).not.toHaveBeenCalled();
  tunnel.resolve({ url: () => 'https://late.example.test', close: closeTunnel } as never);
  await Promise.all([opening, finishing]);
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
