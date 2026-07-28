import { SystemError } from '@expo/eas-build-job';
import { TypedDocumentNode, gql } from '@urql/core';
import fetch, { Headers } from 'node-fetch';

import { CustomBuildContext } from '../../customBuildContext';

type ArtifactUploadSession = {
  url: string;
  headers: Record<string, string>;
};

type CreateArtifactUploadSessionData = {
  deviceRunSession: {
    createArtifactUploadSession: {
      uploadSession: ArtifactUploadSession;
      thumbnailUploadSession: ArtifactUploadSession | null;
    };
  };
};

type CreateArtifactUploadSessionVariables = {
  deviceRunSessionId: string;
  input: {
    name: string;
    filename: string;
    kind?: string;
    metadata?: Record<string, unknown>;
    size: number;
    thumbnail?: {
      filename: string;
      size: number;
    };
  };
};

// This uses an explicitly typed document so build-tools can roll out after the API change without
// requiring the new schema to already be deployed while installing dependencies.
const CREATE_DEVICE_RUN_SESSION_ARTIFACT_UPLOAD_SESSION_MUTATION = gql`
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
        thumbnailUploadSession {
          url
          headers
        }
      }
    }
  }
` as TypedDocumentNode<CreateArtifactUploadSessionData, CreateArtifactUploadSessionVariables>;

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
    thumbnail,
  }: {
    deviceRunSessionId: string;
    artifactId: string;
    name: string;
    filename: string;
    kind: string | undefined;
    metadata?: Record<string, unknown>;
    size: number;
    stream: NodeJS.ReadableStream;
    thumbnail?: {
      filename: string;
      size: number;
      stream: NodeJS.ReadableStream;
    };
  }
): Promise<void> {
  const { uploadSession, thumbnailUploadSession } =
    await createDeviceRunSessionArtifactUploadSessionAsync(ctx, {
      deviceRunSessionId,
      artifactId,
      name,
      filename,
      kind,
      metadata,
      size,
      thumbnail,
    });
  if (thumbnail && !thumbnailUploadSession) {
    throw new SystemError(
      `Failed to create thumbnail upload session for device run session artifact ${artifactId}`
    );
  }

  await Promise.all([
    uploadStreamAsync(uploadSession, stream, artifactId),
    ...(thumbnail && thumbnailUploadSession
      ? [uploadStreamAsync(thumbnailUploadSession, thumbnail.stream, `${artifactId} thumbnail`)]
      : []),
  ]);
}

async function uploadStreamAsync(
  uploadSession: ArtifactUploadSession,
  stream: NodeJS.ReadableStream,
  artifactId: string
): Promise<void> {
  const response = await fetch(uploadSession.url, {
    method: 'PUT',
    headers: new Headers(uploadSession.headers as Record<string, string>),
    body: stream,
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
    thumbnail,
  }: {
    deviceRunSessionId: string;
    artifactId: string;
    name: string;
    filename: string;
    kind: string | undefined;
    metadata?: Record<string, unknown>;
    size: number;
    thumbnail?: {
      filename: string;
      size: number;
    };
  }
) {
  const result = await ctx.graphqlClient
    .mutation(CREATE_DEVICE_RUN_SESSION_ARTIFACT_UPLOAD_SESSION_MUTATION, {
      deviceRunSessionId,
      input: {
        name,
        filename,
        ...(kind !== undefined ? { kind } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        size,
        ...(thumbnail !== undefined
          ? { thumbnail: { filename: thumbnail.filename, size: thumbnail.size } }
          : {}),
      },
    })
    .toPromise();
  if (result.error) {
    throw new SystemError(
      `Failed to create upload session for device run session artifact ${artifactId}: ${result.error.message}`,
      { cause: result.error }
    );
  }
  return result.data!.deviceRunSession.createArtifactUploadSession;
}
