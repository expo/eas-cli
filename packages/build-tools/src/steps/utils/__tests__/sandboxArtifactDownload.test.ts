import { SystemError, UserError } from '@expo/eas-build-job';
import { Client, CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';
import fetch, { Response } from 'node-fetch';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  downloadSandboxArtifactAsync,
  parseSandboxArtifactSource,
  sanitizeSandboxArtifactFilename,
} from '../sandboxArtifactDownload';

// Jest fake timers do not cover node:timers/promises, so the wait moves the fake clock itself.
jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }));

const DOWNLOAD_URL = 'https://storage.example.test/sandbox-artifacts/file?signature=secret';

type SandboxFixture = {
  id: string;
  status: string;
  createdAt: string;
  artifacts: { id: string; name: string }[];
};

type ArtifactFixture = {
  id: string;
  name: string;
  filename: string;
  downloadUrl: string | null;
  sandbox: { id: string; status: string };
};

function createArtifact(overrides: Partial<ArtifactFixture> = {}): ArtifactFixture {
  return {
    id: randomUUID(),
    name: 'sentry-123.bundle',
    filename: 'sentry-123.bundle',
    downloadUrl: DOWNLOAD_URL,
    sandbox: { id: randomUUID(), status: 'STOPPED' },
    ...overrides,
  };
}

function createSandbox(artifacts: { id: string; name: string }[]): SandboxFixture {
  return { id: randomUUID(), status: 'STOPPED', createdAt: '2026-11-12T10:00:00.000Z', artifacts };
}

/** Each artifact lookup returns the next entry of `artifactLookups`; the last entry repeats. */
function createMockGraphqlClient({
  sandboxes = [],
  artifactLookups = [],
  error,
}: {
  sandboxes?: SandboxFixture[];
  artifactLookups?: ArtifactFixture[];
  error?: CombinedError;
}): Client {
  let artifactLookupCount = 0;
  return {
    query: jest.fn((_query, variables: { agentRunId?: string; sandboxArtifactId?: string }) => ({
      toPromise: async () => {
        if (error) {
          return { error, data: undefined };
        }
        if (variables.agentRunId) {
          return { data: { agentRuns: { byId: { id: variables.agentRunId, sandboxes } } } };
        }
        const artifact =
          artifactLookups[Math.min(artifactLookupCount++, artifactLookups.length - 1)];
        return { data: { sandboxArtifacts: { byId: artifact } } };
      },
    })),
  } as unknown as Client;
}

function artifactLookupCount(graphqlClient: Client): number {
  return jest
    .mocked(graphqlClient.query)
    .mock.calls.filter(([, variables]) => 'sandboxArtifactId' in (variables as object)).length;
}

function mockDownload(body = 'bundle content'): void {
  jest
    .mocked(fetch)
    .mockImplementation(
      async () => ({ ok: true, status: 200, body: Readable.from(body) }) as unknown as Response
    );
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  jest.mocked(setTimeoutAsync).mockImplementation(async (ms, _value, options) => {
    options?.signal?.throwIfAborted();
    jest.advanceTimersByTime(ms ?? 0);
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.mocked(fetch).mockReset();
});

describe(downloadSandboxArtifactAsync, () => {
  it('downloads an artifact by ID into a new temporary directory', async () => {
    const artifact = createArtifact();
    const graphqlClient = createMockGraphqlClient({ artifactLookups: [artifact] });
    mockDownload();
    const signal = new AbortController().signal;

    const result = await downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient,
      artifactId: artifact.id,
      signal,
    });

    expect(result.artifactId).toBe(artifact.id);
    expect(path.basename(result.artifactPath)).toBe('sentry-123.bundle');
    expect(path.dirname(path.dirname(result.artifactPath))).toBe(os.tmpdir());
    expect(await fs.promises.readFile(result.artifactPath, 'utf8')).toBe('bundle content');
    expect(graphqlClient.query).toHaveBeenCalledTimes(1);
    expect(graphqlClient.query).toHaveBeenCalledWith(
      expect.anything(),
      { sandboxArtifactId: artifact.id },
      { fetch: expect.any(Function) }
    );
    // The storage URL is signed, so the job token is not sent to it.
    expect(fetch).toHaveBeenCalledWith(DOWNLOAD_URL, { signal });
  });

  it('finds an artifact by name in the sandboxes of an agent run', async () => {
    const artifact = createArtifact();
    const agentRunId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      sandboxes: [
        createSandbox([{ id: randomUUID(), name: 'other.bundle' }]),
        createSandbox([
          { id: randomUUID(), name: 'sentry-123.bundle.sha256' },
          { id: artifact.id, name: artifact.name },
        ]),
      ],
      artifactLookups: [artifact],
    });
    mockDownload();

    const result = await downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient,
      agentRunId,
      name: 'sentry-123.bundle',
    });

    expect(result.artifactId).toBe(artifact.id);
    expect(await fs.promises.readFile(result.artifactPath, 'utf8')).toBe('bundle content');
    expect(graphqlClient.query).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { agentRunId },
      undefined
    );
    expect(graphqlClient.query).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { sandboxArtifactId: artifact.id },
      undefined
    );
  });

  it('fails when no sandbox of the agent run has an artifact with the name', async () => {
    const agentRunId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      sandboxes: [createSandbox([{ id: randomUUID(), name: 'other.bundle' }]), createSandbox([])],
    });

    const download = downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient,
      agentRunId,
      name: 'sentry-123.bundle',
    });

    await expect(download).rejects.toBeInstanceOf(UserError);
    await expect(download).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_SANDBOX_ARTIFACT_NOT_FOUND',
      message:
        `No sandbox of agent run ${agentRunId} has an artifact named "sentry-123.bundle" ` +
        '(sandboxes checked: 2). ' +
        'Check the logs of the agent job to see if the agent uploaded the artifact.',
    });
    expect(graphqlClient.query).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails and lists each match when several sandboxes have an artifact with the name', async () => {
    const agentRunId = randomUUID();
    const firstSandbox = createSandbox([{ id: randomUUID(), name: 'sentry-123.bundle' }]);
    const secondSandbox = {
      ...createSandbox([{ id: randomUUID(), name: 'sentry-123.bundle' }]),
      status: 'RUNNING',
      createdAt: '2026-11-12T10:05:00.000Z',
    };
    const graphqlClient = createMockGraphqlClient({ sandboxes: [firstSandbox, secondSandbox] });

    const download = downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient,
      agentRunId,
      name: 'sentry-123.bundle',
    });

    await expect(download).rejects.toBeInstanceOf(UserError);
    await expect(download).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_SANDBOX_ARTIFACT_AMBIGUOUS_NAME',
      message:
        `Agent run ${agentRunId} has 2 artifacts named "sentry-123.bundle", expected one:\n` +
        `- artifact ${firstSandbox.artifacts[0].id} in sandbox ${firstSandbox.id} (STOPPED, created 2026-11-12T10:00:00.000Z)\n` +
        `- artifact ${secondSandbox.artifacts[0].id} in sandbox ${secondSandbox.id} (RUNNING, created 2026-11-12T10:05:00.000Z)\n` +
        'Review the artifacts, then pass the ID of the correct one as artifact_id.',
    });
    // No artifact is selected, so none is looked up or downloaded.
    expect(graphqlClient.query).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('waits for the upload while the sandbox is not in a final status', async () => {
    const sandbox = { id: randomUUID(), status: 'RUNNING' };
    const pending = createArtifact({ downloadUrl: null, sandbox });
    const graphqlClient = createMockGraphqlClient({
      artifactLookups: [pending, pending, pending, { ...pending, downloadUrl: DOWNLOAD_URL }],
    });
    mockDownload();

    const result = await downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient,
      artifactId: pending.id,
    });

    expect(result.artifactId).toBe(pending.id);
    expect(setTimeoutAsync).toHaveBeenCalledTimes(3);
    expect(setTimeoutAsync).toHaveBeenCalledWith(5_000, undefined, { signal: undefined });
    expect(artifactLookupCount(graphqlClient)).toBe(4);
  });

  it('fails after about 2 minutes when the sandbox stays in a status that is not final', async () => {
    const sandbox = { id: randomUUID(), status: 'RUNNING' };
    const pending = createArtifact({ downloadUrl: null, sandbox });
    const graphqlClient = createMockGraphqlClient({ artifactLookups: [pending] });
    const start = Date.now();

    const download = downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient,
      artifactId: pending.id,
    });

    await expect(download).rejects.toBeInstanceOf(UserError);
    await expect(download).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_SANDBOX_ARTIFACT_UPLOAD_NOT_FINISHED',
      message:
        `Sandbox artifact ${pending.id} has no file to download: the upload did not finish. ` +
        `Sandbox ${sandbox.id} still has the status RUNNING after a wait of 120 seconds. ` +
        'Run this job after the sandbox stops.',
    });
    expect(Date.now() - start).toBe(120_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['STOPPED', 'ERRORED'])(
    'retries for about 10 seconds, then fails, when the sandbox is %s',
    async status => {
      const sandbox = { id: randomUUID(), status };
      const pending = createArtifact({ downloadUrl: null, sandbox });
      const graphqlClient = createMockGraphqlClient({ artifactLookups: [pending] });
      const start = Date.now();

      const download = downloadSandboxArtifactAsync({
        logger: createMockLogger(),
        graphqlClient,
        artifactId: pending.id,
      });

      await expect(download).rejects.toBeInstanceOf(UserError);
      await expect(download).rejects.toMatchObject({
        errorCode: 'EAS_DOWNLOAD_SANDBOX_ARTIFACT_UPLOAD_NOT_FINISHED',
        message:
          `Sandbox artifact ${pending.id} has no file to download: the upload did not finish. ` +
          `Sandbox ${sandbox.id} has the status ${status}, so the upload cannot finish anymore. ` +
          'Check the logs of the agent job to see why the upload failed.',
      });
      expect(Date.now() - start).toBe(10_000);
      expect(setTimeoutAsync).toHaveBeenCalledWith(2_000, undefined, { signal: undefined });
      expect(artifactLookupCount(graphqlClient)).toBe(6);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('downloads an upload that www finalizes soon after the sandbox stops', async () => {
    const running = createArtifact({
      downloadUrl: null,
      sandbox: { id: randomUUID(), status: 'RUNNING' },
    });
    const stopped = { ...running, sandbox: { ...running.sandbox, status: 'STOPPED' } };
    const graphqlClient = createMockGraphqlClient({
      artifactLookups: [running, stopped, stopped, { ...stopped, downloadUrl: DOWNLOAD_URL }],
    });
    mockDownload();

    const result = await downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient,
      artifactId: running.id,
    });

    expect(result.artifactId).toBe(running.id);
    expect(jest.mocked(setTimeoutAsync).mock.calls.map(([ms]) => ms)).toEqual([
      5_000, 2_000, 2_000,
    ]);
  });

  it('gives a sandbox that stops near the end of the wait its full 10 seconds', async () => {
    const running = createArtifact({
      downloadUrl: null,
      sandbox: { id: randomUUID(), status: 'RUNNING' },
    });
    const stopped = { ...running, sandbox: { ...running.sandbox, status: 'STOPPED' } };
    const graphqlClient = createMockGraphqlClient({
      artifactLookups: [...Array.from({ length: 24 }, () => running), stopped],
    });
    const start = Date.now();

    await expect(
      downloadSandboxArtifactAsync({
        logger: createMockLogger(),
        graphqlClient,
        artifactId: running.id,
      })
    ).rejects.toThrow('has the status STOPPED');
    expect(Date.now() - start).toBe(130_000);
  });

  it('stops the wait when aborted', async () => {
    const pending = createArtifact({
      downloadUrl: null,
      sandbox: { id: randomUUID(), status: 'RUNNING' },
    });
    const graphqlClient = createMockGraphqlClient({ artifactLookups: [pending] });
    const controller = new AbortController();
    const failure = new Error('step timed out');
    jest.mocked(setTimeoutAsync).mockImplementation(async (_ms, _value, options) => {
      controller.abort(failure);
      options?.signal?.throwIfAborted();
    });

    await expect(
      downloadSandboxArtifactAsync({
        logger: createMockLogger(),
        graphqlClient,
        artifactId: pending.id,
        signal: controller.signal,
      })
    ).rejects.toBe(failure);
    expect(artifactLookupCount(graphqlClient)).toBe(1);
  });

  it.each([404, 410])('explains the 90-day retention on HTTP %s', async status => {
    const artifact = createArtifact();
    jest
      .mocked(fetch)
      .mockResolvedValue({ ok: false, status, text: async () => 'NoSuchKey' } as any);

    const download = downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient: createMockGraphqlClient({ artifactLookups: [artifact] }),
      artifactId: artifact.id,
    });

    await expect(download).rejects.toBeInstanceOf(UserError);
    await expect(download).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_SANDBOX_ARTIFACT_FILE_UNAVAILABLE',
      message:
        `Failed to download sandbox artifact ${artifact.id} (HTTP ${status}). ` +
        'The file is unavailable. Sandbox artifact files are deleted 90 days after the upload, ' +
        'so run the agent again to create a new artifact.',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails without the signed URL in the message on another HTTP error', async () => {
    const artifact = createArtifact();
    jest
      .mocked(fetch)
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Error' } as any);

    const download = downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient: createMockGraphqlClient({ artifactLookups: [artifact] }),
      artifactId: artifact.id,
    });

    await expect(download).rejects.toThrow(
      `Failed to download sandbox artifact ${artifact.id} (HTTP 500): Internal Error`
    );
    await expect(download).rejects.not.toThrow('signature');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('requests a new download URL for the attempt after a transfer failure', async () => {
    const artifact = createArtifact();
    const secondUrl = 'https://storage.example.test/sandbox-artifacts/file?signature=second';
    const graphqlClient = createMockGraphqlClient({
      artifactLookups: [artifact, { ...artifact, downloadUrl: secondUrl }],
    });
    jest
      .mocked(fetch)
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: Readable.from('bundle content'),
      } as unknown as Response);

    const download = downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient,
      artifactId: artifact.id,
    });
    await jest.advanceTimersByTimeAsync(60_000);
    const result = await download;

    expect(await fs.promises.readFile(result.artifactPath, 'utf8')).toBe('bundle content');
    expect(jest.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([DOWNLOAD_URL, secondUrl]);
  });

  it('throws SystemError when the transfer keeps failing', async () => {
    const artifact = createArtifact();
    jest
      .mocked(fetch)
      .mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

    const download = downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient: createMockGraphqlClient({ artifactLookups: [artifact] }),
      artifactId: artifact.id,
    });
    const settled = download.catch(error => error);
    await jest.advanceTimersByTimeAsync(120_000);
    const error = await settled;

    expect(error).toBeInstanceOf(SystemError);
    expect(error.message).toBe(
      `Could not download sandbox artifact ${artifact.id}: socket hang up (ECONNRESET)`
    );
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('throws UserError when GraphQL rejects the lookup', async () => {
    const artifactId = randomUUID();
    const graphqlClient = createMockGraphqlClient({
      error: new CombinedError({ graphQLErrors: [new GraphQLError('Entity not authorized')] }),
    });

    const download = downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient,
      artifactId,
    });

    await expect(download).rejects.toBeInstanceOf(UserError);
    await expect(download).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_SANDBOX_ARTIFACT_FETCH_FAILED',
      message: `Could not fetch sandbox artifact ${artifactId}: [GraphQL] Entity not authorized`,
    });
    expect(graphqlClient.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\evil.sh', 'evil.sh'],
    ['/abs/path/file.bundle', 'file.bundle'],
    ['..', 'artifact'],
    ['', 'artifact'],
    ['dir/', 'artifact'],
    ['.gitconfig', 'gitconfig'],
    ['--upload-pack=evil', 'upload-pack_evil'],
    ['a b;$(rm -rf ~)\n.bundle', 'a_b_rm_-rf_.bundle'],
  ])('writes the unsafe filename %j as %j inside the new directory', async (filename, expected) => {
    // The name is unsafe too, and must not reach the path.
    const artifact = createArtifact({ filename, name: '../../name-is-not-used' });
    mockDownload();

    const { artifactPath } = await downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient: createMockGraphqlClient({ artifactLookups: [artifact] }),
      artifactId: artifact.id,
    });

    expect(path.basename(artifactPath)).toBe(expected);
    expect(path.basename(path.dirname(artifactPath))).toMatch(/^download_sandbox_artifact-/);
    expect(path.dirname(path.dirname(artifactPath))).toBe(os.tmpdir());
    expect(await fs.promises.readFile(artifactPath, 'utf8')).toBe('bundle content');
  });

  it('does not extract an archive', async () => {
    const artifact = createArtifact({ filename: 'out.tar.gz' });
    const gzipMagic = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
    jest
      .mocked(fetch)
      .mockResolvedValue({ ok: true, status: 200, body: Readable.from([gzipMagic]) } as any);

    const { artifactPath } = await downloadSandboxArtifactAsync({
      logger: createMockLogger(),
      graphqlClient: createMockGraphqlClient({ artifactLookups: [artifact] }),
      artifactId: artifact.id,
    });

    expect(path.basename(artifactPath)).toBe('out.tar.gz');
    expect(await fs.promises.readFile(artifactPath)).toEqual(gzipMagic);
    expect(await fs.promises.readdir(path.dirname(artifactPath))).toEqual(['out.tar.gz']);
  });
});

describe(parseSandboxArtifactSource, () => {
  it.each([
    ['no input', {}],
    ['only agent_run_id', { agentRunId: randomUUID() }],
    ['only name', { name: 'a.bundle' }],
    ['artifact_id with agent_run_id', { artifactId: randomUUID(), agentRunId: randomUUID() }],
    ['artifact_id with name', { artifactId: randomUUID(), name: 'a.bundle' }],
    ['all three inputs', { artifactId: randomUUID(), agentRunId: randomUUID(), name: 'a.bundle' }],
    ['empty strings', { artifactId: '', agentRunId: '', name: '' }],
    ['an artifact_id that is not a UUID', { artifactId: 'sentry-123.bundle' }],
    ['an agent_run_id that is not a UUID', { agentRunId: 'latest', name: 'a.bundle' }],
  ])('rejects %s', (_description, source) => {
    const parse = (): unknown => parseSandboxArtifactSource(source);

    expect(parse).toThrow(UserError);
    expect(parse).toThrow(
      expect.objectContaining({ errorCode: 'EAS_DOWNLOAD_SANDBOX_ARTIFACT_INVALID_SOURCE' })
    );
  });

  it('names the empty agent_run_id when only name has a value', () => {
    expect(() => parseSandboxArtifactSource({ agentRunId: '', name: 'a.bundle' })).toThrow(
      'Pass artifact_id alone, or agent_run_id together with name. agent_run_id is empty. ' +
        'Check that it is the agent_run_id output of an agent job.'
    );
  });

  it('returns the source of each input mode', () => {
    const artifactId = randomUUID();
    const agentRunId = randomUUID();

    expect(parseSandboxArtifactSource({ artifactId, agentRunId: '', name: '' })).toEqual({
      artifactId,
    });
    expect(parseSandboxArtifactSource({ agentRunId, name: 'a.bundle' })).toEqual({
      agentRunId,
      name: 'a.bundle',
    });
  });
});

describe(sanitizeSandboxArtifactFilename, () => {
  it('limits the length of the filename', () => {
    expect(sanitizeSandboxArtifactFilename('a'.repeat(1000))).toHaveLength(255);
  });
});
