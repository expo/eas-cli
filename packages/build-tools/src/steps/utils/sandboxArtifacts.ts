import {
  type SandboxDaemonCommandResult,
  SandboxDaemonError,
  SandboxDaemonErrorCode,
} from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';

import { SignedUrlUploadApiError, uploadWithSignedUrl } from '../../storage/uploadWithSignedUrl';
import { type LegacySandboxApi } from './legacySandboxApi';
import { type SandboxArtifactUploadSession, type SandboxWorkerApi } from './sandboxWorkerApi';
import { WorkerApiError } from './workerApi';

const WORKER_API_REQUEST_TIMEOUT_MS = 15_000;
const FINALIZE_RETRIES = 2;
const REJECTED_UPLOAD_SESSION_ERROR_CODES = new Set(['VALIDATION_ERROR', 'UNAUTHORIZED']);

type SandboxArtifactUploadOutcome =
  | { status: 'uploaded'; downloadUrl: string }
  | { status: 'failed' };

export class SandboxArtifactUploadManager {
  private readonly uploads = new Set<Promise<unknown>>();
  public readonly stoppedPromise: Promise<void>;

  public constructor(
    private readonly options: {
      workerApi: SandboxWorkerApi | LegacySandboxApi;
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

  public async startAsync({
    filePath,
    name,
    yieldTimeMs,
  }: {
    filePath: string;
    name: string;
    yieldTimeMs: number;
  }): Promise<SandboxDaemonCommandResult<'uploadArtifact'>> {
    this.options.signal.throwIfAborted();
    const deadline = performance.now() + yieldTimeMs;
    const uploadPromise = startSandboxArtifactUploadAsync({ ...this.options, filePath, name });
    const completed = uploadPromise.then(
      ({ completed }) => completed,
      () => {}
    );
    this.uploads.add(completed);
    void completed.finally(() => this.uploads.delete(completed));
    const upload = await uploadPromise;
    let timer: NodeJS.Timeout | undefined;
    try {
      const outcome = await Promise.race([
        upload.completed,
        new Promise<{ status: 'uploading' }>(resolve => {
          timer = setTimeout(
            () => resolve({ status: 'uploading' }),
            Math.max(0, deadline - performance.now())
          );
        }),
      ]);
      return { id: upload.id, ...outcome };
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function startSandboxArtifactUploadAsync({
  workerApi,
  logger,
  filePath,
  name,
  signal,
}: {
  workerApi: SandboxWorkerApi | LegacySandboxApi;
  logger: bunyan;
  filePath: string;
  name: string;
  signal: AbortSignal;
}): Promise<{ id: string; completed: Promise<SandboxArtifactUploadOutcome> }> {
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
  } = await createSandboxArtifactUploadSessionAsync(
    workerApi,
    { name, filename: path.basename(filePath), size },
    signal
  );
  const completed = (async (): Promise<SandboxArtifactUploadOutcome> => {
    logger.info(`Uploading sandbox artifact "${name}" (${artifactId}, ${size} bytes).`);
    try {
      await putSandboxArtifactAsync({ filePath, size, uploadSession, signal });
    } catch (error) {
      logger.error({ err: error }, `Failed to upload sandbox artifact "${name}" (${artifactId}).`);
      return { status: 'failed' };
    }
    let downloadUrl: string;
    try {
      downloadUrl = await workerApi.finalizeArtifactAsync(artifactId, {
        signal,
        timeoutMs: WORKER_API_REQUEST_TIMEOUT_MS,
        retries: FINALIZE_RETRIES,
        logger,
      });
    } catch (error) {
      logger.error(
        { err: error },
        `Uploaded sandbox artifact "${name}" (${artifactId}), but could not finalize it.`
      );
      return { status: 'failed' };
    }
    logger.info(`Uploaded sandbox artifact "${name}" (${artifactId}, ${size} bytes).`);
    return { status: 'uploaded', downloadUrl };
  })();
  return { id: artifactId, completed };
}

async function createSandboxArtifactUploadSessionAsync(
  workerApi: SandboxWorkerApi | LegacySandboxApi,
  input: { name: string; filename: string; size: number },
  signal: AbortSignal
): Promise<SandboxArtifactUploadSession> {
  try {
    return await workerApi.createArtifactUploadSessionAsync(input, {
      signal,
      timeoutMs: WORKER_API_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    signal.throwIfAborted();
    if (
      error instanceof WorkerApiError &&
      error.code !== undefined &&
      REJECTED_UPLOAD_SESSION_ERROR_CODES.has(error.code)
    ) {
      throw new SandboxDaemonError(SandboxDaemonErrorCode.BAD_REQUEST, error.message, {
        cause: error,
      });
    }
    throw error;
  }
}

async function putSandboxArtifactAsync({
  filePath,
  size,
  uploadSession,
  signal,
}: {
  filePath: string;
  size: number;
  uploadSession: SandboxArtifactUploadSession['uploadSession'];
  signal: AbortSignal;
}): Promise<void> {
  try {
    await uploadWithSignedUrl(
      {
        signedUrl: uploadSession,
        srcGeneratorAsync: async () =>
          size === 0 ? Readable.from([]) : createReadStream(filePath, { start: 0, end: size - 1 }),
      },
      { signal, retries: 2, retryIntervalMs: 500 }
    );
  } catch (error) {
    if (!(error instanceof SignedUrlUploadApiError && error.status === 412)) {
      throw error;
    }
  }
}
