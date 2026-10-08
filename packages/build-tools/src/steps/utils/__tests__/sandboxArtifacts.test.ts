jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('node:fs');
jest.unmock('node:fs/promises');

import { SandboxDaemonErrorCode, SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { type Client, CombinedError } from '@urql/core';
import fetch, { type RequestInit } from 'node-fetch';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type Readable } from 'node:stream';
import { inspect } from 'node:util';

import { SandboxArtifactUploadManager, startSandboxArtifactUploadAsync } from '../sandboxArtifacts';

const { FetchError, Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

const ARTIFACT_ID = '0199c0de-7b3a-7c1e-8f00-1234567890ab';
const SIGNED_URL = 'https://uploads.expo.test/artifact?X-Amz-Signature=secret-signature';

const createdResult = {
  data: {
    sandbox: {
      createArtifactUploadSession: {
        artifact: { id: ARTIFACT_ID },
        uploadSession: { url: SIGNED_URL, headers: { 'If-None-Match': '*' } },
      },
    },
  },
};
const finalizedResult = { data: { sandbox: { finalizeArtifact: { id: ARTIFACT_ID } } } };

describe('sandbox artifact uploads', () => {
  let directory: string;
  let filePath: string;
  let mutation: jest.Mock;
  let graphqlClient: Client;
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
    mutation = jest.fn();
    logger = { info: jest.fn(), error: jest.fn() };
    graphqlClient = { mutation } as unknown as Client;
    uploadArtifactAsync = async options =>
      await startSandboxArtifactUploadAsync({
        graphqlClient,
        sandboxId: 'sandbox-id',
        logger: logger as unknown as bunyan,
        ...options,
      });
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('returns the artifact id before the PUT completes', async () => {
    mockMutationResults(createdResult, finalizedResult);
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
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      { sandboxId: 'sandbox-id', input: { name: 'Crash log', filename: 'crash.log', size: 5 } },
      expect.anything()
    );
    respond(new Response('', { status: 200 }));
    await upload.completed;
    expect(mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      { artifactId: ARTIFACT_ID },
      expect.anything()
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('sends exactly the stat size on every attempt when the file grows', async () => {
    mutation
      .mockReturnValueOnce({
        toPromise: async () => {
          await fs.appendFile(filePath, ' and more');
          return createdResult;
        },
      })
      .mockReturnValueOnce({ toPromise: async () => finalizedResult });
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
    mockMutationResults(createdResult, finalizedResult);
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

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      { sandboxId: 'sandbox-id', input: { name: 'Empty log', filename: 'crash.log', size: 0 } },
      expect.anything()
    );
    expect(body).toBe('');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('finalizes when a retry fails the upload precondition', async () => {
    mockMutationResults(createdResult, finalizedResult);
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
    expect(mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      { artifactId: ARTIFACT_ID },
      expect.anything()
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith(
      `Uploaded sandbox artifact "Crash log" (${ARTIFACT_ID}, 5 bytes).`
    );
  });

  it('retries finalize after a server error and logs a failure that persists', async () => {
    mockMutationResults(
      createdResult,
      {
        error: new CombinedError({
          networkError: new Error('Bad Gateway'),
          response: { status: 502 },
        }),
      },
      {
        error: new CombinedError({
          graphQLErrors: ['Sandbox artifact "Crash log" has no uploaded file.'],
          response: { status: 200 },
        }),
      }
    );
    jest.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 200 }));

    const upload = await uploadArtifactAsync({
      filePath,
      name: 'Crash log',
      signal: new AbortController().signal,
    });

    await expect(upload.completed).resolves.toBeUndefined();
    expect(mutation).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      `Uploaded sandbox artifact "Crash log" (${ARTIFACT_ID}), but could not finalize it.`
    );
  });

  it.each(['VALIDATION_ERROR', 'UNAUTHORIZED'])(
    'rejects a %s upload session error as a bad request with the GraphQL message',
    async errorCode => {
      const message =
        'Sandbox already has an artifact named "Crash log". Use a different name for this artifact.';
      mockMutationResults({
        error: new CombinedError({ graphQLErrors: [{ message, extensions: { errorCode } }] }),
      });

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

  it('rejects an unexpected upload session error as a system error', async () => {
    mockMutationResults({
      error: new CombinedError({
        graphQLErrors: [
          { message: 'Request failed.', extensions: { errorCode: 'UNEXPECTED_ERROR' } },
        ],
      }),
    });

    const upload = uploadArtifactAsync({
      filePath,
      name: 'Crash log',
      signal: new AbortController().signal,
    });

    await expect(upload).rejects.toBeInstanceOf(SystemError);
    await expect(upload).rejects.toMatchObject({ message: 'Request failed.' });
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
    expect(mutation).not.toHaveBeenCalled();
  });

  it('keeps the signed URL out of logs', async () => {
    mockMutationResults(createdResult);
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
    expect(logged).toContain('Artifact PUT failed: ECONNRESET.');
    expect(logged).not.toContain('secret-signature');
  });

  it('waits for an aborted upload before the manager reports that it stopped', async () => {
    mockMutationResults(createdResult);
    jest.mocked(fetch).mockReturnValueOnce(new Promise(() => {}) as ReturnType<typeof fetch>);
    const controller = new AbortController();
    const manager = new SandboxArtifactUploadManager({
      graphqlClient,
      sandboxId: 'sandbox-id',
      logger: logger as unknown as bunyan,
      signal: controller.signal,
    });

    await expect(manager.startAsync({ filePath, name: 'Crash log' })).resolves.toBe(ARTIFACT_ID);
    controller.abort();
    await manager.stoppedPromise;

    expect(logger.error).toHaveBeenCalledWith(
      expect.anything(),
      `Failed to upload sandbox artifact "Crash log" (${ARTIFACT_ID}).`
    );
    await expect(manager.startAsync({ filePath, name: 'Late log' })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  function mockMutationResults(...results: unknown[]): void {
    for (const result of results) {
      mutation.mockReturnValueOnce({ toPromise: async () => result });
    }
  }
});
