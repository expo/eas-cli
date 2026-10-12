import { SystemError } from '@expo/eas-build-job';
import { graphql } from 'gql.tada';

import { CustomBuildContext } from '../../customBuildContext';
import { graphqlAbortContext } from '../../utils/graphqlAbort';
import {
  ArtifactPutError,
  ArtifactPutNetworkError,
  type ArtifactSource,
  putArtifactWithRetriesAsync,
} from './artifactPut';
import { withDeviceRunSessionTimeoutAsync } from './deviceRunSessionTimeout';

const CREATE_DEVICE_RUN_SESSION_ARTIFACT_UPLOAD_SESSION_MUTATION = graphql(`
  mutation CreateDeviceRunSessionArtifactUploadSession(
    $deviceRunSessionId: ID!
    $input: CreateDeviceRunSessionArtifactUploadSessionInput!
  ) {
    deviceRunSession {
      createArtifactUploadSession(deviceRunSessionId: $deviceRunSessionId, input: $input) {
        uploadSession {
          url
          headers
        }
      }
    }
  }
`);

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
  options: ArtifactMetadata & ArtifactSource & { signal?: AbortSignal }
): Promise<void> {
  try {
    const uploadSession = await withDeviceRunSessionTimeoutAsync(
      { name: 'Artifact upload session creation', timeoutMs: 15_000, signal: options.signal },
      async signal => await createDeviceRunSessionArtifactUploadSessionAsync(ctx, options, signal)
    );
    options.signal?.throwIfAborted();
    await putArtifactWithRetriesAsync({ uploadSession, source: options, signal: options.signal });
  } catch (error) {
    if (error instanceof ArtifactPutError || error instanceof ArtifactPutNetworkError) {
      throw new DeviceRunSessionArtifactUploadError(options.artifactId, error.reason);
    }
    throw error;
  } finally {
    // One-shot callers may have opened their stream before upload-session creation failed.
    options.stream.destroy();
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
) {
  const result = await ctx.graphqlClient
    .mutation(
      CREATE_DEVICE_RUN_SESSION_ARTIFACT_UPLOAD_SESSION_MUTATION,
      {
        deviceRunSessionId,
        input: {
          name,
          filename,
          ...(kind !== undefined ? { kind } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
          size,
        },
      },
      graphqlAbortContext(signal)
    )
    .toPromise();
  signal.throwIfAborted();
  if (result.error) {
    throw new SystemError(
      `Failed to create upload session for device run session artifact ${artifactId}: ${result.error.message}`,
      { cause: result.error }
    );
  }
  return result.data!.deviceRunSession.createArtifactUploadSession.uploadSession;
}
