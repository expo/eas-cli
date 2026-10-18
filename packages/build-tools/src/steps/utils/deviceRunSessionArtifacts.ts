import { SystemError } from '@expo/eas-build-job';

import { CustomBuildContext } from '../../customBuildContext';
import {
  ArtifactPutError,
  ArtifactPutNetworkError,
  type ArtifactSource,
  type ArtifactUploadSession,
  putArtifactWithRetriesAsync,
} from './artifactPut';
import { withDeviceRunSessionTimeoutAsync } from './deviceRunSessionTimeout';
import { requireDeviceRunSessionWorkerApi } from './deviceRunSessionWorkerApi';

type ArtifactMetadata = {
  deviceRunSessionId: string;
  artifactId: string;
  name: string;
  filename: string;
  kind: string | undefined;
  metadata?: Record<string, unknown>;
  size: number;
};

export async function uploadDeviceRunSessionArtifactAsync(
  ctx: CustomBuildContext,
  options: ArtifactMetadata & ArtifactSource & { signal?: AbortSignal; attempts?: number }
): Promise<void> {
  try {
    const uploadSession = await withDeviceRunSessionTimeoutAsync(
      { name: 'Artifact upload session creation', timeoutMs: 15_000, signal: options.signal },
      async signal => await createDeviceRunSessionArtifactUploadSessionAsync(ctx, options, signal)
    );
    options.signal?.throwIfAborted();
    await putArtifactWithRetriesAsync(
      { uploadSession, source: options, signal: options.signal },
      { attempts: options.attempts }
    );
  } catch (error) {
    if (error instanceof ArtifactPutError || error instanceof ArtifactPutNetworkError) {
      throw new DeviceRunSessionArtifactUploadError(options.artifactId, error.reason);
    }
    throw error;
  }
}

class DeviceRunSessionArtifactUploadError extends SystemError {
  constructor(artifactId: string, reason: string) {
    super(`Failed to upload device run session artifact ${artifactId}: ${reason}.`);
  }
}

async function createDeviceRunSessionArtifactUploadSessionAsync(
  ctx: CustomBuildContext,
  { deviceRunSessionId, artifactId, name, filename, kind, metadata, size }: ArtifactMetadata,
  signal: AbortSignal
): Promise<ArtifactUploadSession> {
  const workerApi = requireDeviceRunSessionWorkerApi(ctx);
  let uploadSession: ArtifactUploadSession;
  try {
    uploadSession = await workerApi.createArtifactUploadSessionAsync(
      {
        name,
        filename,
        ...(kind !== undefined ? { kind } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        size,
      },
      { signal }
    );
  } catch (err) {
    signal.throwIfAborted();
    throw new SystemError(
      `Failed to create upload session for device run session artifact ${artifactId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err }
    );
  }
  signal.throwIfAborted();
  return uploadSession;
}
