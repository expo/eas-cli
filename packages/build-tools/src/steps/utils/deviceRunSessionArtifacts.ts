import { SystemError } from '@expo/eas-build-job';
import { graphql } from 'gql.tada';
import fetch, { Headers } from 'node-fetch';

import { CustomBuildContext } from '../../customBuildContext';

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

export async function uploadDeviceRunSessionArtifactAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    artifactId,
    name,
    filename,
    kind,
    metadata,
    size,
    stream,
    signal,
  }: {
    deviceRunSessionId: string;
    artifactId: string;
    name: string;
    filename: string;
    kind: string | undefined;
    metadata?: Record<string, unknown>;
    size: number;
    stream: NodeJS.ReadableStream;
    signal?: AbortSignal;
  }
): Promise<void> {
  signal?.throwIfAborted();
  const uploadSession = await createDeviceRunSessionArtifactUploadSessionAsync(ctx, {
    deviceRunSessionId,
    artifactId,
    name,
    filename,
    kind,
    metadata,
    size,
    signal,
  });
  signal?.throwIfAborted();
  const response = await fetch(uploadSession.url, {
    method: 'PUT',
    headers: new Headers(uploadSession.headers as Record<string, string>),
    body: stream,
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new SystemError(
      `Failed to upload device run session artifact ${artifactId}: ${response.status} ${response.statusText}`,
      { cause: response }
    );
  }
}

async function createDeviceRunSessionArtifactUploadSessionAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    artifactId,
    name,
    filename,
    kind,
    metadata,
    size,
    signal,
  }: {
    deviceRunSessionId: string;
    artifactId: string;
    name: string;
    filename: string;
    kind: string | undefined;
    metadata?: Record<string, unknown>;
    size: number;
    signal?: AbortSignal;
  }
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
      signal
        ? {
            fetch: (input, options) =>
              globalThis.fetch(input, {
                ...options,
                signal: AbortSignal.any([signal, ...(options?.signal ? [options.signal] : [])]),
              }),
          }
        : undefined
    )
    .toPromise();
  if (result.error) {
    throw new SystemError(
      `Failed to create upload session for device run session artifact ${artifactId}: ${result.error.message}`,
      { cause: result.error }
    );
  }
  return result.data!.deviceRunSession.createArtifactUploadSession.uploadSession;
}
