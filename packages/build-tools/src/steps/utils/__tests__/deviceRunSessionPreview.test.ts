import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform } from '@expo/steps';
import { SystemError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { getEventListeners } from 'node:events';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import fetch from 'node-fetch';

import { type CustomBuildContext } from '../../../customBuildContext';
import * as processes from '../../../utils/processes';
import { turtleFetch } from '../../../utils/turtleFetch';
import {
  captureDeviceRunSessionPreviewAsync,
  ensureMacosPreviewEncoderInstalledAsync,
  startDeviceRunSessionPreview,
} from '../deviceRunSessionPreview';
import { DEVICE_RUN_SESSION_TOKEN_HEADER } from '../deviceRunSessionWorkerApi';

jest.mock('node-fetch', () => {
  const actual = jest.requireActual('node-fetch');
  return {
    __esModule: true,
    ...actual,
    default: jest.fn(),
  };
});
jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/turtleFetch');
const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

const DEVICE_RUN_SESSION_TOKEN = 'device-run-session-token-value';
const PREVIEW_UPLOAD_SESSION_URL =
  'https://api.expo.test/v2/device-run-session-worker/preview-upload-session';
const uploadSession = {
  url: 'https://uploads.expo.test/preview',
  headers: { 'content-type': 'image/webp' },
};

function createCtx(): CustomBuildContext {
  return {
    env: { EAS_DEVICE_RUN_SESSION_TOKEN: DEVICE_RUN_SESSION_TOKEN },
    expoApiV2BaseUrl: 'https://api.expo.test/v2/',
  } as unknown as CustomBuildContext;
}

function uploadSessionResponse(): InstanceType<typeof Response> {
  return new Response(JSON.stringify({ data: { uploadSession } }), {
    headers: { 'content-type': 'application/json' },
  });
}

describe(startDeviceRunSessionPreview, () => {
  const image = Buffer.from('webp-image');
  let captureAsync: jest.Mock<Promise<Buffer>, [AbortSignal]>;
  let logger: bunyan;
  let ctx: CustomBuildContext;
  let preview: ReturnType<typeof startDeviceRunSessionPreview> | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    captureAsync = jest.fn().mockResolvedValue(image);
    jest
      .mocked(turtleFetch)
      .mockReset()
      .mockImplementation(async () => uploadSessionResponse());
    ctx = createCtx();
    logger = { warn: jest.fn() } as unknown as bunyan;
    jest
      .mocked(fetch)
      .mockReset()
      .mockResolvedValue(new Response('', { status: 200 }));
  });
  afterEach(async () => {
    await preview?.stopAsync();
    preview = undefined;
    jest.useRealTimers();
  });
  const start = () => {
    preview = startDeviceRunSessionPreview({
      ctx,
      deviceRunSessionId: 'session-id',
      captureAsync,
      logger,
    });
    return preview;
  };

  it('uploads immediately and reuses the URL every 60 seconds', async () => {
    start();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledWith(
      'https://uploads.expo.test/preview',
      expect.objectContaining({
        method: 'PUT',
        body: expect.any(Readable),
        headers: { 'content-type': 'image/webp', 'content-length': String(image.length) },
      })
    );
    await jest.advanceTimersByTimeAsync(59_999);
    expect(captureAsync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(captureAsync).toHaveBeenCalledTimes(2);
    expect(turtleFetch).toHaveBeenCalledTimes(1);
    await preview!.stopAsync();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(captureAsync).toHaveBeenCalledTimes(2);
  });

  it('retries capture errors without creating an empty artifact', async () => {
    captureAsync.mockRejectedValueOnce(new Error('device not ready'));
    start();
    await jest.advanceTimersByTimeAsync(0);
    expect(turtleFetch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a failed upload with the same URL', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 403 }));
    start();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(turtleFetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not log the signed upload URL when the upload request fails', async () => {
    const { FetchError } = jest.requireActual('node-fetch') as typeof import('node-fetch');
    jest
      .mocked(fetch)
      .mockRejectedValueOnce(
        new FetchError('network timeout at: https://uploads.expo.test/preview', 'request-timeout')
      );
    start();
    await jest.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [fields] = jest.mocked(logger.warn).mock.calls[0] as unknown as [{ err: Error }];
    expect(fields.err.message).toBe('Signed URL upload failed: network error.');
    expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toContain('uploads.expo.test');
  });

  it('reuses the upload URL for the full session', async () => {
    start();
    await jest.advanceTimersByTimeAsync(119 * 60_000);
    expect(turtleFetch).toHaveBeenCalledTimes(1);
  });

  it('does not overlap captures and aborts pending work when stopped', async () => {
    captureAsync.mockImplementation(
      signal =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        })
    );
    const handle = start();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(captureAsync).toHaveBeenCalledTimes(1);
    await handle.stopAsync();
    expect(captureAsync.mock.calls[0][0].aborted).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not upload a capture that finishes after shutdown', async () => {
    let finish!: (image: Buffer) => void;
    captureAsync.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const handle = start();
    const stopping = handle.stopAsync();
    finish(image);
    await stopping;
    expect(turtleFetch).not.toHaveBeenCalled();
  });
});

describe('session preview upload session from the worker API', () => {
  let preview: ReturnType<typeof startDeviceRunSessionPreview> | undefined;
  let logger: bunyan;

  beforeEach(() => {
    jest.useFakeTimers();
    jest
      .mocked(turtleFetch)
      .mockReset()
      .mockImplementation(async () => uploadSessionResponse());
    logger = { warn: jest.fn() } as unknown as bunyan;
    jest
      .mocked(fetch)
      .mockReset()
      .mockResolvedValue(new Response('', { status: 200 }));
  });

  afterEach(async () => {
    await preview?.stopAsync();
    preview = undefined;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const start = (ctx: CustomBuildContext = createCtx()) => {
    preview = startDeviceRunSessionPreview({
      ctx,
      deviceRunSessionId: 'session-id',
      captureAsync: async () => Buffer.from('webp-image'),
      logger,
    });
    return preview;
  };

  it('sends the device run session token when creating the upload session', async () => {
    start();
    await jest.advanceTimersByTimeAsync(0);
    expect(turtleFetch).toHaveBeenCalledWith(
      PREVIEW_UPLOAD_SESSION_URL,
      'POST',
      expect.objectContaining({
        headers: { [DEVICE_RUN_SESSION_TOKEN_HEADER]: DEVICE_RUN_SESSION_TOKEN },
        signal: expect.any(AbortSignal),
      })
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('logs a failure and uploads nothing when the job has no device run session token', async () => {
    start({
      env: {},
      expoApiV2BaseUrl: 'https://api.expo.test/v2/',
    } as unknown as CustomBuildContext);
    await jest.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(SystemError) },
      'Could not refresh the session preview; retrying in 60 seconds.'
    );
    const [{ err }] = jest.mocked(logger.warn).mock.calls[0] as unknown as [{ err: Error }];
    expect(err.message).toMatch(
      /^This device run session job has no EAS_DEVICE_RUN_SESSION_TOKEN secret\./
    );
    expect(turtleFetch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['shutdown', 'timeout'])('aborts a stalled worker API request on %s', async reason => {
    const timeout = new AbortController();
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    let requestSignal: AbortSignal | undefined;
    let rejectRequest!: (error: Error) => void;
    jest.mocked(turtleFetch).mockImplementation(
      (_url, _method, options) =>
        new Promise((_, reject) => {
          rejectRequest = reject;
          requestSignal = options.signal as AbortSignal;
          requestSignal.addEventListener('abort', () => reject(requestSignal!.reason), {
            once: true,
          });
        })
    );
    const handle = start();
    await jest.advanceTimersByTimeAsync(0);
    let stopped = false;
    let stopping: Promise<void> | undefined;
    if (reason === 'shutdown') {
      stopping = handle.stopAsync().then(() => {
        stopped = true;
      });
    } else {
      timeout.abort(new Error('preview attempt timed out'));
    }
    await jest.advanceTimersByTimeAsync(0);
    const aborted = requestSignal!.aborted;
    const stoppedAfterAbort = stopped;
    // Always release the fake transport so a regression cannot hang test cleanup.
    rejectRequest(new Error('test cleanup'));
    await jest.advanceTimersByTimeAsync(0);
    expect(aborted).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    if (stopping) {
      expect(stoppedAfterAbort).toBe(true);
      await stopping;
    } else {
      expect(logger.warn).toHaveBeenCalled();
      jest.mocked(turtleFetch).mockImplementation(async () => uploadSessionResponse());
      jest.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe(captureDeviceRunSessionPreviewAsync, () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
  const webp = Buffer.from('encoded-webp');
  const resized = Buffer.from('resized-png');
  it.each([
    [BuildRuntimePlatform.DARWIN, 'selected-device'],
    [BuildRuntimePlatform.LINUX, 'selected-device'],
    [BuildRuntimePlatform.LINUX, 'no-device-id'],
  ] as const)(
    'captures the selected device on %s and removes temporary files',
    async (runtimePlatform, device) => {
      jest.mocked(spawn).mockImplementation((command, args) => {
        if (command === 'adb' && args[0] === 'devices') {
          return Promise.resolve({
            stdout: 'List of devices attached\nselected-device\tdevice\noffline-device\toffline\n',
          }) as ReturnType<typeof spawn>;
        }
        if (command === 'adb') {
          expect(args).toEqual(['-s', 'selected-device', 'exec-out', 'screencap', '-p']);
          return Object.assign(Promise.resolve({ stdout: '', stderr: '' }), {
            child: { stdout: Readable.from([png]) },
          }) as ReturnType<typeof spawn>;
        }
        return (async () => {
          if (command === 'xcrun') {
            expect(args.slice(0, 4)).toEqual(['simctl', 'io', 'selected-device', 'screenshot']);
            await writeFile(args[4], Uint8Array.from(png));
          } else if (command === 'sips') {
            expect(args.slice(0, 2)).toEqual(['-Z', '320']);
            expect(await readFile(args[2])).toEqual(png);
            await writeFile(args[args.indexOf('--out') + 1], Uint8Array.from(resized));
          } else if (command === 'cwebp') {
            expect(await readFile(args[args.indexOf('-o') - 1])).toEqual(resized);
            await writeFile(args[args.indexOf('-o') + 1], Uint8Array.from(webp));
          } else {
            // Homebrew's FFmpeg cannot encode WebP, so macOS must not use it.
            expect(runtimePlatform).toBe(BuildRuntimePlatform.LINUX);
            expect(command).toBe('ffmpeg');
            expect(await readFile(args[args.indexOf('-i') + 1])).toEqual(png);
            expect(args).toContain('libwebp');
            await writeFile(args[args.length - 1], Uint8Array.from(webp));
          }
          return { stdout: '', stderr: '' };
        })() as ReturnType<typeof spawn>;
      });
      expect(
        await captureDeviceRunSessionPreviewAsync({
          runtimePlatform,
          device,
          env: {},
          signal: new AbortController().signal,
        })
      ).toEqual(webp);
      expect(
        (await readdir(os.tmpdir())).filter(name => name.startsWith('session-preview-'))
      ).toEqual([]);
    }
  );

  it('skips ambiguous Android devices instead of capturing the wrong screen', async () => {
    jest
      .mocked(spawn)
      .mockResolvedValue({ stdout: 'device-one\tdevice\ndevice-two\tdevice\n' } as Awaited<
        ReturnType<typeof spawn>
      >);
    await expect(
      captureDeviceRunSessionPreviewAsync({
        runtimePlatform: BuildRuntimePlatform.LINUX,
        device: 'no-device-id',
        env: {},
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('Expected exactly one connected Android device');
  });

  it('cleans up temporary files when capture fails', async () => {
    jest.mocked(spawn).mockRejectedValue(new Error('capture failed'));
    await expect(
      captureDeviceRunSessionPreviewAsync({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        device: 'device',
        env: {},
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('capture failed');
    expect(
      (await readdir(os.tmpdir())).filter(name => name.startsWith('session-preview-'))
    ).toEqual([]);
  });
});

describe(ensureMacosPreviewEncoderInstalledAsync, () => {
  const logger = { info: jest.fn() } as unknown as bunyan;

  it.each([true, false])(
    'installs webp only when cwebp is missing (present: %s)',
    async present => {
      jest.mocked(spawn).mockReset();
      jest
        .mocked(spawn)
        .mockImplementation(
          command =>
            (command === 'cwebp' && !present
              ? Promise.reject(new Error('command not found: cwebp'))
              : Promise.resolve({ stdout: '', stderr: '' })) as ReturnType<typeof spawn>
        );
      await ensureMacosPreviewEncoderInstalledAsync({ env: { HOME: '/Users/expo' }, logger });
      const brewCalls = jest.mocked(spawn).mock.calls.filter(([command]) => command === 'brew');
      if (present) {
        expect(brewCalls).toEqual([]);
      } else {
        expect(brewCalls).toEqual([
          [
            'brew',
            ['install', 'webp'],
            {
              env: { HOME: '/Users/expo', HOMEBREW_NO_AUTO_UPDATE: '1' },
              logger,
              detached: true,
            },
          ],
        ]);
      }
    }
  );

  it('does not start a command when setup was already canceled', async () => {
    jest.mocked(spawn).mockReset();
    const controller = new AbortController();
    const reason = new Error('session ended');
    controller.abort(reason);
    await expect(
      ensureMacosPreviewEncoderInstalledAsync({ env: {}, logger, signal: controller.signal })
    ).rejects.toBe(reason);
    expect(spawn).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  it.each(['cwebp', 'brew'])(
    'waits for canceled %s to close and never starts another command',
    async command => {
      jest.mocked(spawn).mockReset();
      const controller = new AbortController();
      const child = { pid: 12345, kill: jest.fn() };
      const killed = jest.spyOn(processes, 'killProcessGroup').mockImplementation(() => {});
      const closeError = new Error(`${command} closed after cancellation`);
      let entered!: () => void;
      const commandEntered = new Promise<void>(resolve => {
        entered = resolve;
      });
      let close!: (error: Error) => void;
      jest.mocked(spawn).mockImplementation(current => {
        if (current !== command) {
          return Promise.reject(new Error('cwebp missing')) as ReturnType<typeof spawn>;
        }
        entered();
        return Object.assign(
          new Promise((_, reject) => {
            close = reject;
          }),
          { child }
        ) as unknown as ReturnType<typeof spawn>;
      });
      let settled = false;
      const result = ensureMacosPreviewEncoderInstalledAsync({
        env: {},
        logger,
        signal: controller.signal,
      }).then(
        () => {
          settled = true;
        },
        error => {
          settled = true;
          return error;
        }
      );
      try {
        await commandEntered;
        controller.abort(new Error('session ended'));
        await Promise.resolve();
        expect(killed).toHaveBeenCalledWith(child, 'SIGKILL');
        expect(settled).toBe(false);
        expect(jest.mocked(spawn).mock.calls.at(-1)).toEqual([
          command,
          command === 'cwebp' ? ['-version'] : ['install', 'webp'],
          expect.objectContaining({ detached: true }),
        ]);
        expect(jest.mocked(spawn).mock.calls.every(([, , options]) => !options?.signal)).toBe(true);
      } finally {
        close(closeError);
        await result;
        killed.mockRestore();
      }
      expect(spawn).toHaveBeenCalledTimes(command === 'cwebp' ? 1 : 2);
      expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    }
  );

  it('rejects an installation failure and removes its abort listeners', async () => {
    jest.mocked(spawn).mockReset();
    const controller = new AbortController();
    const failure = new Error('brew failed');
    jest.mocked(spawn).mockRejectedValue(failure);
    await expect(
      ensureMacosPreviewEncoderInstalledAsync({ env: {}, logger, signal: controller.signal })
    ).rejects.toBe(failure);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  it('removes its abort listener after a successful probe', async () => {
    jest.mocked(spawn).mockReset();
    jest.mocked(spawn).mockResolvedValue({ stdout: '', stderr: '' } as never);
    const controller = new AbortController();
    await ensureMacosPreviewEncoderInstalledAsync({ env: {}, logger, signal: controller.signal });
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });
});
