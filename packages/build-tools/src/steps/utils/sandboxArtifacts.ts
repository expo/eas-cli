import { SandboxDaemonError, SandboxDaemonErrorCode, SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { type Client, CombinedError } from '@urql/core';
import { graphql } from 'gql.tada';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { graphqlAbortContext } from '../../utils/graphqlAbort';
import { OperationTimeoutError, withTimeoutAsync } from '../../utils/timeout';
import {
  ArtifactPutError,
  type ArtifactUploadSession,
  putArtifactWithRetriesAsync,
} from './artifactPut';

const CREATE_SANDBOX_ARTIFACT_UPLOAD_SESSION_MUTATION = graphql(`
  mutation CreateSandboxArtifactUploadSession(
    $sandboxId: ID!
    $input: CreateSandboxArtifactUploadSessionInput!
  ) {
    sandbox {
      createArtifactUploadSession(sandboxId: $sandboxId, input: $input) {
        artifact {
          id
        }
        uploadSession {
          url
          headers
        }
      }
    }
  }
`);

const FINALIZE_SANDBOX_ARTIFACT_MUTATION = graphql(`
  mutation FinalizeSandboxArtifact($artifactId: ID!) {
    sandbox {
      finalizeArtifact(artifactId: $artifactId) {
        id
      }
    }
  }
`);

const FINALIZE_ATTEMPTS = 3;
const REJECTED_UPLOAD_SESSION_ERROR_CODES = new Set(['VALIDATION_ERROR', 'UNAUTHORIZED']);

export class SandboxArtifactUploadManager {
  private readonly uploads = new Set<Promise<void>>();
  public readonly stoppedPromise: Promise<void>;

  public constructor(
    private readonly options: {
      graphqlClient: Client;
      sandboxId: string;
      logger: bunyan;
      signal: AbortSignal;
    }
  ) {
    this.stoppedPromise = (async () => {
      if (!options.signal.aborted) {
        await new Promise<void>(resolve => {
          options.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      await Promise.all(this.uploads);
    })();
  }

  public async startAsync({ filePath, name }: { filePath: string; name: string }): Promise<string> {
    this.options.signal.throwIfAborted();
    const upload = startSandboxArtifactUploadAsync({ ...this.options, filePath, name });
    const completed = upload.then(
      ({ completed }) => completed,
      () => {}
    );
    this.uploads.add(completed);
    void completed.finally(() => this.uploads.delete(completed));
    const { id } = await upload;
    return id;
  }
}

export async function startSandboxArtifactUploadAsync({
  graphqlClient,
  sandboxId,
  logger,
  filePath,
  name,
  signal,
}: {
  graphqlClient: Client;
  sandboxId: string;
  logger: bunyan;
  filePath: string;
  name: string;
  signal: AbortSignal;
}): Promise<{ id: string; completed: Promise<void> }> {
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new SandboxDaemonError(
        SandboxDaemonErrorCode.BAD_REQUEST,
        `File does not exist: ${filePath}`
      );
    }
    if (error?.code === 'EACCES') {
      throw new SandboxDaemonError(
        SandboxDaemonErrorCode.BAD_REQUEST,
        `File is not accessible: ${filePath}`
      );
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw new SandboxDaemonError(
      SandboxDaemonErrorCode.BAD_REQUEST,
      `${filePath} is not a regular file. To upload a directory, create an archive first, for example tar -czf out.tgz ${filePath}, then upload the archive.`
    );
  }
  const size = stats.size;
  const {
    artifact: { id: artifactId },
    uploadSession,
  } = await withTimeoutAsync(
    { name: 'Sandbox artifact upload session creation', timeoutMs: 15_000, signal },
    async createSignal =>
      await createSandboxArtifactUploadSessionAsync(
        graphqlClient,
        { sandboxId, name, filename: path.basename(filePath), size },
        createSignal
      )
  );
  const completed = (async () => {
    logger.info(`Uploading sandbox artifact "${name}" (${artifactId}, ${size} bytes).`);
    try {
      await putSandboxArtifactAsync({ filePath, size, uploadSession, signal });
    } catch (error) {
      logger.error({ err: error }, `Failed to upload sandbox artifact "${name}" (${artifactId}).`);
      return;
    }
    try {
      await finalizeSandboxArtifactAsync(graphqlClient, artifactId, signal);
    } catch (error) {
      logger.error(
        { err: error },
        `Uploaded sandbox artifact "${name}" (${artifactId}), but could not finalize it.`
      );
      return;
    }
    logger.info(`Uploaded sandbox artifact "${name}" (${artifactId}, ${size} bytes).`);
  })();
  return { id: artifactId, completed };
}

async function createSandboxArtifactUploadSessionAsync(
  graphqlClient: Client,
  {
    sandboxId,
    name,
    filename,
    size,
  }: { sandboxId: string; name: string; filename: string; size: number },
  signal: AbortSignal
) {
  const result = await graphqlClient
    .mutation(
      CREATE_SANDBOX_ARTIFACT_UPLOAD_SESSION_MUTATION,
      { sandboxId, input: { name, filename, size } },
      graphqlAbortContext(signal)
    )
    .toPromise();

  signal.throwIfAborted();

  if (result.error) {
    const { graphQLErrors } = result.error;
    const message =
      graphQLErrors.length > 0
        ? graphQLErrors.map(error => error.message).join('\n')
        : `Failed to create an upload session for sandbox artifact "${name}": ${result.error.message}`;
    if (
      graphQLErrors.length > 0 &&
      graphQLErrors.every(error =>
        REJECTED_UPLOAD_SESSION_ERROR_CODES.has(error.extensions?.errorCode as string)
      )
    ) {
      throw new SandboxDaemonError(SandboxDaemonErrorCode.BAD_REQUEST, message, {
        cause: result.error,
      });
    }
    throw new SystemError(message, { cause: result.error });
  }
  return result.data!.sandbox.createArtifactUploadSession;
}

async function putSandboxArtifactAsync({
  filePath,
  size,
  uploadSession,
  signal,
}: {
  filePath: string;
  size: number;
  uploadSession: ArtifactUploadSession;
  signal: AbortSignal;
}): Promise<void> {
  const openStream = (): Readable =>
    size === 0 ? Readable.from([]) : createReadStream(filePath, { start: 0, end: size - 1 });
  const stream = openStream();
  try {
    await putArtifactWithRetriesAsync({
      uploadSession,
      source: { stream, reopenStream: openStream },
      signal,
    });
  } catch (error) {
    if (!(error instanceof ArtifactPutError && error.status === 412)) {
      throw error;
    }
  } finally {
    stream.destroy();
  }
}

async function finalizeSandboxArtifactAsync(
  graphqlClient: Client,
  artifactId: string,
  signal: AbortSignal
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await withTimeoutAsync(
        { name: 'Sandbox artifact finalization', timeoutMs: 15_000, signal },
        async finalizeSignal => {
          const result = await graphqlClient
            .mutation(
              FINALIZE_SANDBOX_ARTIFACT_MUTATION,
              { artifactId },
              graphqlAbortContext(finalizeSignal)
            )
            .toPromise();
          finalizeSignal.throwIfAborted();
          if (result.error) {
            throw result.error;
          }
        }
      );
      return;
    } catch (error) {
      signal.throwIfAborted();
      const retryable =
        error instanceof OperationTimeoutError ||
        (error instanceof CombinedError && isTransientGraphqlError(error));
      if (!retryable || attempt >= FINALIZE_ATTEMPTS) {
        throw error;
      }
      await delay(500 * attempt, undefined, { signal });
    }
  }
}

function isTransientGraphqlError(error: CombinedError): boolean {
  const status: number | undefined = error.response?.status;
  return status === undefined ? error.networkError !== undefined : status >= 500;
}
