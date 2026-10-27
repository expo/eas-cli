import { SystemError } from '@expo/eas-build-job';
import type { Readable } from 'node:stream';

import { CustomBuildContext } from '../../customBuildContext';
import {
  type SignedUrl,
  SignedUrlUploadApiError,
  SignedUrlUploadNetworkError,
  uploadWithSignedUrl,
} from '../../storage/uploadWithSignedUrl';
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
  options: ArtifactMetadata & {
    openStream: () => Readable;
    signal?: AbortSignal;
    attempts?: number;
  }
): Promise<void> {
  try {
    const uploadSession = await withDeviceRunSessionTimeoutAsync(
      { name: 'Artifact upload session creation', timeoutMs: 15_000, signal: options.signal },
      async signal => await createDeviceRunSessionArtifactUploadSessionAsync(ctx, options, signal)
    );
    options.signal?.throwIfAborted();
    await uploadWithSignedUrl(
      { signedUrl: uploadSession, srcGeneratorAsync: async () => options.openStream() },
      { signal: options.signal, retries: (options.attempts ?? 1) - 1, retryIntervalMs: 500 }
    );
  } catch (error) {
    if (error instanceof SignedUrlUploadApiError || error instanceof SignedUrlUploadNetworkError) {
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
): Promise<SignedUrl> {
  const workerApi = requireDeviceRunSessionWorkerApi(ctx);
  let uploadSession: SignedUrl;
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
