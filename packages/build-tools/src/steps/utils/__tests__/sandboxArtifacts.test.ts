jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('node:fs');
jest.unmock('node:fs/promises');

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

import { SandboxWorkerApi, SandboxWorkerApiError } from '../sandboxWorkerApi';
import { SandboxArtifactUploadManager, startSandboxArtifactUploadAsync } from '../sandboxArtifacts';

const { AbortError, FetchError, Response } = jest.requireActual(
  'node-fetch'
) as typeof import('node-fetch');

const ARTIFACT_ID = '0199c0de-7b3a-7c1e-8f00-1234567890ab';
const SIGNED_URL = 'https://uploads.expo.test/artifact?X-Amz-Signature=secret-signature';
const DOWNLOAD_URL = 'https://downloads.expo.test/artifact?X-Amz-Signature=download-signature';

const createdResult = {
  data: {
    artifact: { id: ARTIFACT_ID },
    uploadSession: { url: SIGNED_URL, headers: { 'If-None-Match': '*' } },
  },
};
const finalizedResult = { data: { id: ARTIFACT_ID, downloadUrl: DOWNLOAD_URL } };

describe('sandbox artifact uploads', () => {
  let directory: string;
  let filePath: string;
  let apiFetch: jest.Mock;
  let putFetch: jest.Mock;
  let workerApi: SandboxWorkerApi;
  let logger: { info: jest.Mock; error: jest.Mock };
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
    apiFetch = jest.fn();
    putFetch = jest.fn();
    jest
      .mocked(fetch)
      .mockImplementation((url, init) =>
        String(url) === SIGNED_URL ? putFetch(url, init) : apiFetch(url, init)
      );
    logger = { info: jest.fn(), error: jest.fn() };
    workerApi = new SandboxWorkerApi('https://api.expo.test/v2/', 'worker-token');
    uploadArtifactAsync = async options =>
      await startSandboxArtifactUploadAsync({
        workerApi,
        logger: logger as unknown as bunyan,
        ...options,
      });
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('uses the worker credential only for API requests, not the signed upload URL', async () => {
    const requests: string[] = [];
    jest.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push(url);
      if (url === SIGNED_URL) {
        expect(
          (init?.headers as Record<string, string>)?.['expo-sandbox-worker-token']
        ).toBeUndefined();
        return new Response('', { status: 200 });
      }
      expect(init?.headers).toMatchObject({ 'expo-sandbox-worker-token': 'worker-token' });
      expect(init?.headers).not.toHaveProperty('Authorization');
      return new Response(
        JSON.stringify({
          data: url.endsWith('/artifact-upload-sessions')
            ? { artifact: { id: ARTIFACT_ID }, uploadSession: { url: SIGNED_URL, headers: {} } }
            : { id: ARTIFACT_ID, downloadUrl: DOWNLOAD_URL },
        }),
        { status: 200 }
      );
    });
    const upload = await startSandboxArtifactUploadAsync({
      workerApi: new SandboxWorkerApi('https://api.expo.test/v2/', 'worker-token'),
      logger: logger as unknown as bunyan,
      filePath,
      name: 'result',
      signal: new AbortController().signal,
    });
    expect(await upload.completed).toEqual({ status: 'uploaded', downloadUrl: DOWNLOAD_URL });
    expect(requests).toEqual([
      'https://api.expo.test/v2/sandbox-worker/artifact-upload-sessions',
      SIGNED_URL,
      `https://api.expo.test/v2/sandbox-worker/artifacts/${ARTIFACT_ID}/finalize`,
    ]);
  });

  it('returns the artifact id before the PUT completes', async () => {
    mockApiResults(createdResult, finalizedResult);
    let respond!: (response: InstanceType<typeof Response>) => void;
    putFetch.mockReturnValueOnce(
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
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/artifact-upload-sessions'),
      expect.objectContaining({
        body: JSON.stringify({ name: 'Crash log', filename: 'crash.log', size: 5 }),
      })
    );
    respond(new Response('', { status: 200 }));
    await expect(upload.completed).resolves.toEqual({
      status: 'uploaded',
      downloadUrl: DOWNLOAD_URL,
    });
    expect(apiFetch).toHaveBeenLastCalledWith(
      expect.stringContaining(`/artifacts/${ARTIFACT_ID}/finalize`),
      expect.anything()
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('sends exactly the stat size on every attempt when the file grows', async () => {
    apiFetch
      .mockImplementationOnce(async () => {
        await fs.appendFile(filePath, ' and more');
        return apiResponse(createdResult);
      })
      .mockResolvedValueOnce(apiResponse(finalizedResult));
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
    putFetch
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
    mockApiResults(createdResult, finalizedResult);
    let body: string | undefined;
    putFetch.mockImplementationOnce((async (_url: unknown, init?: RequestInit) => {
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

    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/artifact-upload-sessions'),
      expect.objectContaining({
        body: JSON.stringify({ name: 'Empty log', filename: 'crash.log', size: 0 }),
      })
    );
    expect(body).toBe('');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('finalizes when a retry fails the upload precondition', async () => {
    mockApiResults(createdResult, finalizedResult);
    putFetch
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

    expect(putFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenLastCalledWith(
      expect.stringContaining(`/artifacts/${ARTIFACT_ID}/finalize`),
      expect.anything()
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith(
      `Uploaded sandbox artifact "Crash log" (${ARTIFACT_ID}, 5 bytes).`
    );
  });

  it('retries finalize after a server error and logs a failure that persists', async () => {
    mockApiResults(
      createdResult,
      { status: 502, errors: [{ message: 'Bad Gateway' }] },
      { status: 400, errors: [{ message: 'Sandbox artifact has no uploaded file.' }] }
    );
    putFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

    const upload = await uploadArtifactAsync({
      filePath,
      name: 'Crash log',
      signal: new AbortController().signal,
    });

    await expect(upload.completed).resolves.toEqual({ status: 'failed' });
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      `Uploaded sandbox artifact "Crash log" (${ARTIFACT_ID}), but could not finalize it.`
    );
  });

  it.each([400, 401, 403])('returns API rejection %s as a bad request', async status => {
    const message = 'Use a different artifact name.';
    mockApiResults({ status, errors: [{ message }] });
    await expect(
      uploadArtifactAsync({ filePath, name: 'Crash log', signal: new AbortController().signal })
    ).rejects.toMatchObject({ code: SandboxDaemonErrorCode.BAD_REQUEST, message });
    expect(putFetch).not.toHaveBeenCalled();
  });

  it('propagates an unexpected upload session error', async () => {
    mockApiResults({ status: 500, errors: [{ message: 'Request failed.' }] });
    await expect(
      uploadArtifactAsync({ filePath, name: 'Crash log', signal: new AbortController().signal })
    ).rejects.toBeInstanceOf(SandboxWorkerApiError);
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
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('keeps the signed URL out of logs', async () => {
    mockApiResults(createdResult);
    putFetch.mockRejectedValue(
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
    expect(putFetch).toHaveBeenCalledTimes(3);
    expect(logged).toContain('Artifact PUT failed: ECONNRESET.');
    expect(logged).not.toContain('secret-signature');
  });

  it('waits for an aborted upload before the manager reports that it stopped', async () => {
    mockApiResults(createdResult);
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
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      case: 'a finalized upload as uploaded with its download URL',
      finalizeResult: finalizedResult,
      outcome: { status: 'uploaded', downloadUrl: DOWNLOAD_URL },
    },
    {
      case: 'a failed finalization as failed',
      finalizeResult: {
        status: 400,
        errors: [{ message: 'Sandbox artifact has no uploaded file.' }],
      },
      outcome: { status: 'failed' },
    },
    {
      case: 'a finalized artifact without a download URL as failed',
      finalizeResult: {
        data: { id: ARTIFACT_ID, downloadUrl: null },
      },
      outcome: { status: 'failed' },
    },
  ])(
    'waits for an upload that ends within the yield time and reports $case',
    async ({ finalizeResult, outcome }) => {
      mockApiResults(createdResult, finalizeResult);
      putFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
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
    mockApiResults(createdResult);
    apiFetch.mockImplementationOnce(async () => {
      finalizeCalled();
      return apiResponse(finalizedResult);
    });
    let respond!: (response: InstanceType<typeof Response>) => void;
    putFetch.mockReturnValueOnce(
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
    apiFetch.mockImplementationOnce(async () => {
      await delay(400);
      return apiResponse(createdResult);
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

  function createManager(signal: AbortSignal): SandboxArtifactUploadManager {
    return new SandboxArtifactUploadManager({
      workerApi,
      logger: logger as unknown as bunyan,
      signal,
    });
  }

  function mockPutUntilAborted(): void {
    putFetch.mockImplementationOnce((async (_url: unknown, init?: RequestInit) => {
      await new Promise<never>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => {
          reject(new AbortError('The user aborted a request.'));
        });
      });
    }) as unknown as typeof fetch);
  }

  function mockApiResults(
    ...results: { status?: number; data?: unknown; errors?: unknown[] }[]
  ): void {
    for (const result of results) {
      apiFetch.mockResolvedValueOnce(apiResponse(result));
    }
  }
});

function apiResponse(result: {
  status?: number;
  data?: unknown;
  errors?: unknown[];
}): InstanceType<typeof Response> {
  return new Response(JSON.stringify(result), { status: result.status ?? 200 });
}
