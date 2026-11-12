jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('node:fs');
jest.unmock('node:fs/promises');
jest.mock('node-fetch', () => {
  const actual = jest.requireActual('node-fetch');
  return {
    __esModule: true,
    ...actual,
    default: jest.fn(),
  };
});

import { SandboxDaemonErrorCode } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import fetch, { type RequestInit } from 'node-fetch';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { type Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { inspect } from 'node:util';

import { SandboxArtifactUploadManager, startSandboxArtifactUploadAsync } from '../sandboxArtifacts';
import { SandboxWorkerApi } from '../sandboxWorkerApi';
import { WorkerApiError } from '../workerApi';

const { AbortError, FetchError, Response } = jest.requireActual(
  'node-fetch'
) as typeof import('node-fetch');

const ARTIFACT_ID = '0199c0de-7b3a-7c1e-8f00-1234567890ab';
const SIGNED_URL = 'https://uploads.expo.test/artifact?X-Amz-Signature=secret-signature';
const DOWNLOAD_URL = 'https://downloads.expo.test/artifact?X-Amz-Signature=download-signature';

const createdSession = {
  artifact: { id: ARTIFACT_ID },
  uploadSession: { url: SIGNED_URL, headers: { 'If-None-Match': '*' } },
};

describe('sandbox artifact uploads', () => {
  let directory: string;
  let filePath: string;
  let workerApi: {
    createArtifactUploadSessionAsync: jest.Mock;
    finalizeArtifactAsync: jest.Mock;
  };
  let logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let uploadArtifactAsync: (options: {
    filePath: string;
    name: string;
    signal: AbortSignal;
  }) => ReturnType<typeof startSandboxArtifactUploadAsync>;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-artifacts-'));
    filePath = path.join(directory, 'crash.log');
    await fs.writeFile(filePath, 'crash');
    jest.mocked(fetch).mockReset();
    workerApi = {
      createArtifactUploadSessionAsync: jest.fn(),
      finalizeArtifactAsync: jest.fn(),
    };
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    uploadArtifactAsync = async options =>
      await startSandboxArtifactUploadAsync({
        workerApi: workerApi as unknown as SandboxWorkerApi,
        logger: logger as unknown as bunyan,
        ...options,
      });
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('returns the artifact id before the PUT completes', async () => {
    mockWorkerApi({ finalize: DOWNLOAD_URL });
    let respond!: (response: InstanceType<typeof Response>) => void;
    jest.mocked(fetch).mockReturnValueOnce(
      new Promise(resolve => {
        respond = resolve;
      }) as ReturnType<typeof fetch>
    );

    const upload = await uploadArtifactAsync({
      filePath,
      name: 'Crash log',
      signal: new AbortController().signal,
    });

    expect(upload.id).toBe(ARTIFACT_ID);
    expect(workerApi.createArtifactUploadSessionAsync).toHaveBeenCalledWith(
      { name: 'Crash log', filename: 'crash.log', size: 5 },
      expect.anything()
    );
    expect(workerApi.finalizeArtifactAsync).not.toHaveBeenCalled();
    respond(new Response('', { status: 200 }));
    await expect(upload.completed).resolves.toEqual({
      status: 'uploaded',
      downloadUrl: DOWNLOAD_URL,
    });
    expect(workerApi.finalizeArtifactAsync).toHaveBeenCalledWith(
      ARTIFACT_ID,
      expect.objectContaining({ retries: 2 })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('sends exactly the stat size on every attempt when the file grows', async () => {
    workerApi.createArtifactUploadSessionAsync.mockImplementationOnce(async () => {
      await fs.appendFile(filePath, ' and more');
      return createdSession;
    });
    workerApi.finalizeArtifactAsync.mockResolvedValueOnce(DOWNLOAD_URL);
    const bodies: string[] = [];
    const respondAfterReadingBody =
      (status: number) =>
      async (_url: unknown, init?: RequestInit): Promise<InstanceType<typeof Response>> => {
        const chunks: Buffer[] = [];
        for await (const chunk of init!.body as Readable) {
          chunks.push(chunk);
        }
        bodies.push(Buffer.concat(chunks).toString());
        return new Response('', { status });
      };
    jest
      .mocked(fetch)
      .mockImplementationOnce(respondAfterReadingBody(503) as unknown as typeof fetch)
      .mockImplementationOnce(respondAfterReadingBody(200) as unknown as typeof fetch);

    const upload = await uploadArtifactAsync({
      filePath,
      name: 'Crash log',
      signal: new AbortController().signal,
    });
    await upload.completed;

    expect(bodies).toEqual(['crash', 'crash']);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('uploads an empty file with an empty body', async () => {
    await fs.writeFile(filePath, '');
    mockWorkerApi({ finalize: DOWNLOAD_URL });
    let body: string | undefined;
    jest.mocked(fetch).mockImplementationOnce((async (_url: unknown, init?: RequestInit) => {
      const chunks: Buffer[] = [];
      for await (const chunk of init!.body as Readable) {
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks).toString();
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch);

    const upload = await uploadArtifactAsync({
      filePath,
      name: 'Empty log',
      signal: new AbortController().signal,
    });
    await upload.completed;

    expect(workerApi.createArtifactUploadSessionAsync).toHaveBeenCalledWith(
      { name: 'Empty log', filename: 'crash.log', size: 0 },
      expect.anything()
    );
    expect(body).toBe('');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('finalizes when a retry fails the upload precondition', async () => {
    mockWorkerApi({ finalize: DOWNLOAD_URL });
    jest
      .mocked(fetch)
      .mockRejectedValueOnce(
        new FetchError(`request to ${SIGNED_URL} failed, reason: socket hang up`, 'system', {
          code: 'ECONNRESET',
        } as any)
      )
      .mockResolvedValueOnce(new Response('', { status: 412, statusText: 'Precondition Failed' }));

    const upload = await uploadArtifactAsync({
      filePath,
      name: 'Crash log',
      signal: new AbortController().signal,
    });
    await upload.completed;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(workerApi.finalizeArtifactAsync).toHaveBeenCalledWith(ARTIFACT_ID, expect.anything());
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith(
      `Uploaded sandbox artifact "Crash log" (${ARTIFACT_ID}, 5 bytes).`
    );
  });

  it('logs a finalize failure and reports the upload as failed', async () => {
    mockWorkerApi({
      finalize: new WorkerApiError(
        'POST /v2/sandbox-worker/artifacts/x/finalize failed with status 502: Bad Gateway',
        502
      ),
    });
    jest.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 200 }));

    const upload = await uploadArtifactAsync({
      filePath,
      name: 'Crash log',
      signal: new AbortController().signal,
    });

    await expect(upload.completed).resolves.toEqual({ status: 'failed' });
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      `Uploaded sandbox artifact "Crash log" (${ARTIFACT_ID}), but could not finalize it.`
    );
  });

  it.each([
    {
      status: 409,
      code: 'ARTIFACT_NAME_CONFLICT',
      apiMessage:
        'Sandbox already has an artifact named "Crash log". Use a different name for this artifact.',
    },
    {
      status: 400,
      code: 'VALIDATION_ERROR',
      apiMessage:
        'Sandbox is stopped, so it cannot upload artifacts. Upload artifacts while the sandbox is running.',
    },
    {
      status: 403,
      code: 'UNAUTHORIZED',
      apiMessage:
        'You are not authorized to upload artifacts for this sandbox. Only the user who created the sandbox can upload its artifacts.',
    },
  ])(
    'rejects a $code upload session error as a bad request with the API message',
    async ({ status, code, apiMessage }) => {
      const message = `POST /v2/sandbox-worker/artifact-upload-sessions failed with status ${status}: ${apiMessage}`;
      workerApi.createArtifactUploadSessionAsync.mockRejectedValueOnce(
        new WorkerApiError(message, status, undefined, code)
      );

      const upload = uploadArtifactAsync({
        filePath,
        name: 'Crash log',
        signal: new AbortController().signal,
      });

      await expect(upload).rejects.toMatchObject({
        code: SandboxDaemonErrorCode.BAD_REQUEST,
        message,
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    { status: 500, code: 'UNEXPECTED_ERROR' },
    { status: 401, code: 'AUTHENTICATION_ERROR' },
    { status: 409, code: 'OTHER_CONFLICT' },
  ])('rethrows a $code upload session error unchanged', async ({ status, code }) => {
    const error = new WorkerApiError('Request failed.', status, undefined, code);
    workerApi.createArtifactUploadSessionAsync.mockRejectedValueOnce(error);

    await expect(
      uploadArtifactAsync({ filePath, name: 'Crash log', signal: new AbortController().signal })
    ).rejects.toBe(error);
  });

  it('rejects a missing file as a bad request without creating an upload session', async () => {
    const missingPath = path.join(directory, 'missing.log');

    const upload = uploadArtifactAsync({
      filePath: missingPath,
      name: 'Crash log',
      signal: new AbortController().signal,
    });

    await expect(upload).rejects.toMatchObject({
      code: SandboxDaemonErrorCode.BAD_REQUEST,
      message: `File does not exist: ${missingPath}`,
    });
    expect(workerApi.createArtifactUploadSessionAsync).not.toHaveBeenCalled();
  });

  it('keeps the signed URL out of logs', async () => {
    mockWorkerApi({});
    jest.mocked(fetch).mockRejectedValue(
      new FetchError(`request to ${SIGNED_URL} failed, reason: socket hang up`, 'system', {
        code: 'ECONNRESET',
      } as any)
    );

    const upload = await uploadArtifactAsync({
      filePath,
      name: 'Crash log',
      signal: new AbortController().signal,
    });
    await upload.completed;

    expect(logger.error).toHaveBeenCalledTimes(1);
    const logged = inspect([logger.info.mock.calls, logger.error.mock.calls], { depth: 10 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(logged).toContain('Signed URL upload failed: ECONNRESET.');
    expect(logged).not.toContain('secret-signature');
  });

  it('waits for an aborted upload before the manager reports that it stopped', async () => {
    mockWorkerApi({});
    mockPutUntilAborted();
    const controller = new AbortController();
    const manager = createManager(controller.signal);

    await expect(
      manager.startAsync({ filePath, name: 'Crash log', yieldTimeMs: 0 })
    ).resolves.toEqual({
      id: ARTIFACT_ID,
      status: 'uploading',
    });
    controller.abort();
    await manager.stoppedPromise;

    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      `Failed to upload sandbox artifact "Crash log" (${ARTIFACT_ID}).`
    );
    await expect(
      manager.startAsync({ filePath, name: 'Late log', yieldTimeMs: 0 })
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(workerApi.createArtifactUploadSessionAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      case: 'a finalized upload as uploaded with its download URL',
      finalize: DOWNLOAD_URL,
      outcome: { status: 'uploaded', downloadUrl: DOWNLOAD_URL },
    },
    {
      case: 'a failed finalization as failed',
      finalize: new WorkerApiError('Sandbox artifact "Crash log" has no uploaded file.', 400),
      outcome: { status: 'failed' },
    },
  ])(
    'waits for an upload that ends within the yield time and reports $case',
    async ({ finalize, outcome }) => {
      mockWorkerApi({ finalize });
      jest.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 200 }));
      const manager = createManager(new AbortController().signal);

      await expect(
        manager.startAsync({ filePath, name: 'Crash log', yieldTimeMs: 30_000 })
      ).resolves.toEqual({ id: ARTIFACT_ID, ...outcome });
    }
  );

  it('reports an upload that outlasts the yield time as uploading and keeps uploading', async () => {
    let finalizeCalled!: () => void;
    const finalizeCalledPromise = new Promise<void>(resolve => {
      finalizeCalled = resolve;
    });
    mockWorkerApi({});
    workerApi.finalizeArtifactAsync.mockImplementationOnce(async () => {
      finalizeCalled();
      return DOWNLOAD_URL;
    });
    let respond!: (response: InstanceType<typeof Response>) => void;
    jest.mocked(fetch).mockReturnValueOnce(
      new Promise(resolve => {
        respond = resolve;
      }) as ReturnType<typeof fetch>
    );
    const manager = createManager(new AbortController().signal);

    await expect(
      manager.startAsync({ filePath, name: 'Crash log', yieldTimeMs: 10 })
    ).resolves.toEqual({ id: ARTIFACT_ID, status: 'uploading' });
    respond(new Response('', { status: 200 }));
    await finalizeCalledPromise;
  });

  it('counts upload session creation toward the yield time', async () => {
    workerApi.createArtifactUploadSessionAsync.mockImplementationOnce(async () => {
      await delay(400);
      return createdSession;
    });
    mockPutUntilAborted();
    const controller = new AbortController();
    const manager = createManager(controller.signal);
    const startedAt = performance.now();

    await expect(
      manager.startAsync({ filePath, name: 'Crash log', yieldTimeMs: 400 })
    ).resolves.toEqual({ id: ARTIFACT_ID, status: 'uploading' });
    expect(performance.now() - startedAt).toBeLessThan(600);
    controller.abort();
    await manager.stoppedPromise;
  });

  describe('with the sandbox worker API', () => {
    const uploadSessionsUrl = 'https://api.expo.test/v2/sandbox-worker/artifact-upload-sessions';

    afterEach(() => {
      jest.useRealTimers();
    });

    it('retries a failed upload session request with the same idempotency key', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
        .mockResolvedValueOnce(jsonResponse({ data: createdSession }))
        .mockResolvedValueOnce(new Response('', { status: 200 }))
        .mockResolvedValueOnce(
          jsonResponse({ data: { id: ARTIFACT_ID, downloadUrl: DOWNLOAD_URL } })
        );

      const uploadPromise = uploadWithWorkerApiAsync();
      while (uploadSessionRequests().length === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
      await jest.advanceTimersByTimeAsync(1000);
      const upload = await uploadPromise;

      await expect(upload.completed).resolves.toEqual({
        status: 'uploaded',
        downloadUrl: DOWNLOAD_URL,
      });
      const keys = uploadSessionRequests().map(
        ([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']
      );
      expect(keys).toEqual([expect.any(String), keys[0]]);
    });

    it('does not retry an artifact name conflict', async () => {
      const apiMessage =
        'Sandbox already has an artifact named "Crash log". Use a different name for this artifact.';
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          jsonResponse({ errors: [{ code: 'ARTIFACT_NAME_CONFLICT', message: apiMessage }] }, 409)
        );

      await expect(uploadWithWorkerApiAsync()).rejects.toMatchObject({
        code: SandboxDaemonErrorCode.BAD_REQUEST,
        message: `POST /v2/sandbox-worker/artifact-upload-sessions failed with status 409: ${apiMessage}`,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    async function uploadWithWorkerApiAsync(): ReturnType<typeof startSandboxArtifactUploadAsync> {
      return await startSandboxArtifactUploadAsync({
        workerApi: new SandboxWorkerApi('https://api.expo.test/v2/', 'sandbox-worker-token'),
        logger: logger as unknown as bunyan,
        filePath,
        name: 'Crash log',
        signal: new AbortController().signal,
      });
    }

    function uploadSessionRequests(): Parameters<typeof fetch>[] {
      return jest.mocked(fetch).mock.calls.filter(([url]) => url === uploadSessionsUrl);
    }

    function jsonResponse(body: unknown, status = 200): InstanceType<typeof Response> {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });

  function createManager(signal: AbortSignal): SandboxArtifactUploadManager {
    return new SandboxArtifactUploadManager({
      workerApi: workerApi as unknown as SandboxWorkerApi,
      logger: logger as unknown as bunyan,
      signal,
    });
  }

  function mockPutUntilAborted(): void {
    jest.mocked(fetch).mockImplementationOnce((async (_url: unknown, init?: RequestInit) => {
      await new Promise<never>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => {
          reject(new AbortError('The user aborted a request.'));
        });
      });
    }) as unknown as typeof fetch);
  }

  function mockWorkerApi({ finalize }: { finalize?: string | Error }): void {
    workerApi.createArtifactUploadSessionAsync.mockResolvedValueOnce(createdSession);
    if (finalize instanceof Error) {
      workerApi.finalizeArtifactAsync.mockRejectedValueOnce(finalize);
    } else if (finalize !== undefined) {
      workerApi.finalizeArtifactAsync.mockResolvedValueOnce(finalize);
    }
  }
});
