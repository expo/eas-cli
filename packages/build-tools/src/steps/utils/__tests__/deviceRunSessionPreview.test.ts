import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { Client, fetchExchange } from '@urql/core';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import fetch from 'node-fetch';

import { type CustomBuildContext } from '../../../customBuildContext';
import {
  captureDeviceRunSessionPreviewAsync,
  startDeviceRunSessionPreview,
} from '../deviceRunSessionPreview';

jest.mock('node-fetch');
jest.mock('@expo/turtle-spawn');
const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

describe(startDeviceRunSessionPreview, () => {
  const image = Buffer.from('webp-image');
  let captureAsync: jest.Mock<Promise<Buffer>, [AbortSignal]>;
  let mutation: jest.Mock;
  let logger: bunyan;
  let ctx: CustomBuildContext;
  let preview: ReturnType<typeof startDeviceRunSessionPreview> | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    captureAsync = jest.fn().mockResolvedValue(image);
    mutation = jest.fn().mockReturnValue({
      toPromise: async () => ({
        data: {
          deviceRunSession: {
            createPreviewUploadSession: {
              uploadSession: {
                url: 'https://uploads.expo.test/preview',
                headers: { 'content-type': 'image/webp' },
              },
            },
          },
        },
      }),
    });
    ctx = { graphqlClient: { mutation } } as unknown as CustomBuildContext;
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
        body: image,
        headers: { 'content-type': 'image/webp' },
      })
    );
    await jest.advanceTimersByTimeAsync(59_999);
    expect(captureAsync).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(captureAsync).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenCalledTimes(1);
    await preview!.stopAsync();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(captureAsync).toHaveBeenCalledTimes(2);
  });

  it('retries capture errors without creating an empty artifact', async () => {
    captureAsync.mockRejectedValueOnce(new Error('device not ready'));
    start();
    await jest.advanceTimersByTimeAsync(0);
    expect(mutation).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a failed upload with the same URL', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 403 }));
    start();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reuses the upload URL for the full session', async () => {
    start();
    await jest.advanceTimersByTimeAsync(119 * 60_000);
    expect(mutation).toHaveBeenCalledTimes(1);
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
    expect(mutation).not.toHaveBeenCalled();
  });
});

describe('session preview with the real GraphQL client', () => {
  const uploadSession = {
    url: 'https://uploads.expo.test/preview',
    headers: { 'content-type': 'image/webp' },
  };
  let graphqlFetch: jest.SpyInstance;
  let preview: ReturnType<typeof startDeviceRunSessionPreview> | undefined;
  let logger: bunyan;

  beforeEach(() => {
    jest.useFakeTimers();
    graphqlFetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new globalThis.Response(
        JSON.stringify({
          data: { deviceRunSession: { createPreviewUploadSession: { uploadSession } } },
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    );
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

  const start = () => {
    const graphqlClient = new Client({
      url: 'https://api.expo.test/graphql',
      exchanges: [fetchExchange],
      fetchOptions: { headers: { Authorization: 'Bearer worker-token' } },
    });
    preview = startDeviceRunSessionPreview({
      ctx: { graphqlClient } as CustomBuildContext,
      deviceRunSessionId: 'session-id',
      captureAsync: async () => Buffer.from('webp-image'),
      logger,
    });
    return preview;
  };

  it('preserves the worker authentication when creating the upload session', async () => {
    start();
    await jest.advanceTimersByTimeAsync(0);
    const [, options] = graphqlFetch.mock.calls[0];
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer worker-token');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['shutdown', 'timeout'])('aborts a stalled GraphQL request on %s', async reason => {
    const timeout = new AbortController();
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    let requestSignal: AbortSignal | undefined;
    let rejectRequest!: (error: Error) => void;
    graphqlFetch.mockImplementation(
      (_url, options) =>
        new Promise((_, reject) => {
          rejectRequest = reject;
          requestSignal = options.signal;
          requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), {
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
      graphqlFetch.mockResolvedValue(
        new globalThis.Response(
          JSON.stringify({
            data: { deviceRunSession: { createPreviewUploadSession: { uploadSession } } },
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      );
      jest.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe(captureDeviceRunSessionPreviewAsync, () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
  const webp = Buffer.from('encoded-webp');
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
          } else {
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
