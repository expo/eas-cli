import path from 'path';

import GCS from '@expo/gcs';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import tar from 'tar';
import { BuildContext } from '@expo/build-tools';
import { asyncResult } from '@expo/results';
import { z } from 'zod';
import { TurtleFetchError, turtleFetch } from '@expo/turtle-common';
import { ArchiveSourceType } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import config from './config';
import { Analytics, Event } from './external/analytics';
import sentry from './sentry';

class ErrorWithMetadata extends Error {
  constructor(
    message: string,
    public metadata: Record<string, any>
  ) {
    super(message);

    Error.captureStackTrace(this, ErrorWithMetadata);
  }
}

export async function uploadApplicationArchiveAsync(
  ctx: BuildContext,
  {
    artifactPaths,
    buildId,
    logger,
  }: {
    artifactPaths: string[];
    buildId: string;
    logger: bunyan;
  }
): Promise<{ filename: string | null }> {
  const { localPath, suffix, size } = await prepareArtifactsForUploadAsync(logger, artifactPaths);
  const filename = `application-${buildId}${suffix}`;

  let uploadSession: GCS.SignedUrl | null = null;

  try {
    // Try to upload to the upload session first.
    const { signedUrl, bucketKey, storageType } = await createUploadSessionAsync(ctx, {
      filename,
      name: 'Application Archive',
      size,
    });

    uploadSession = signedUrl;

    await GCS.uploadWithSignedUrl({
      signedUrl,
      srcGeneratorAsync: async () => {
        return {
          stream: fs.createReadStream(localPath),
        };
      },
    });

    // If the upload succeeded, we save the artifact to the database.
    await saveArtifactAsync(ctx, { bucketKey, type: 'applicationArchive', storageType });

    // The saved artifact has the right filename, we don't need Launcher to rename or store it.
    return { filename: null };
  } catch (err: any) {
    // Otherwise, we log the error and proceed to upload to Launcher's upload URL.
    sentry.handleError('Upload to upload session failed', err, {
      extras: {
        filename,
        size,
        ...uploadSession,
        ...(err instanceof ErrorWithMetadata ? err.metadata : {}),
      },
    });

    // Lack of `gcsSignedUploadUrlForApplicationArchive` means we're being run by workflow-orchestration.
    if (!config.gcsSignedUploadUrlForApplicationArchive) {
      throw new Error(`Failed to upload application archive: ${err?.message}\n${err?.stack}`, {
        cause: err,
      });
    }
  }

  try {
    await GCS.uploadWithSignedUrl({
      signedUrl: config.gcsSignedUploadUrlForApplicationArchive,
      srcGeneratorAsync: async () => {
        return {
          stream: fs.createReadStream(localPath),
        };
      },
    });
  } catch (err: any) {
    throw new Error(`Failed to upload application archive: ${err?.message}\n${err?.stack}`, {
      cause: err,
    });
  }

  return { filename };
}

export async function uploadBuildArtifactsAsync(
  ctx: BuildContext,
  {
    artifactPaths,
    buildId,
    logger,
  }: {
    artifactPaths: string[];
    buildId: string;
    logger: bunyan;
  }
): Promise<{ filename: string | null }> {
  const { localPath, suffix, size } = await prepareArtifactsForUploadAsync(logger, artifactPaths);
  const filename = `artifacts-${buildId}${suffix}`;

  let uploadSession: GCS.SignedUrl | null = null;

  try {
    // Try to upload to the upload session first.
    const { signedUrl, bucketKey, storageType } = await createUploadSessionAsync(ctx, {
      filename,
      name: 'Build Artifacts',
      size,
    });

    uploadSession = signedUrl;

    await GCS.uploadWithSignedUrl({
      signedUrl,
      srcGeneratorAsync: async () => {
        return {
          stream: fs.createReadStream(localPath),
        };
      },
    });

    // If the upload succeeded, we save the artifact to the database.
    await saveArtifactAsync(ctx, { bucketKey, type: 'buildArtifacts', storageType });

    // The saved artifact has the right filename, we don't need Launcher to rename or store it.
    return { filename: null };
  } catch (err: any) {
    // Lack of `gcsSignedUploadUrlForBuildArtifacts` means we're being run by workflow-orchestration.
    if (!config.gcsSignedUploadUrlForBuildArtifacts) {
      throw new Error(`Failed to upload build artifact: ${err?.message}\n${err?.stack}`, {
        cause: err,
      });
    }

    // Otherwise, we log the error and proceed to upload to Launcher's upload URL.
    sentry.handleError('Upload to upload session failed', err, {
      extras: {
        filename,
        size,
        ...uploadSession,
      },
    });
  }

  try {
    await GCS.uploadWithSignedUrl({
      signedUrl: config.gcsSignedUploadUrlForBuildArtifacts,
      srcGeneratorAsync: async () => {
        return {
          stream: fs.createReadStream(localPath),
        };
      },
    });
  } catch (err: any) {
    throw new Error(`Failed to upload build artifact: ${err?.message}\n${err?.stack}`, {
      cause: err,
    });
  }

  return { filename };
}

export async function uploadWorkflowArtifactAsync(
  ctx: BuildContext,
  {
    name: _name,
    logger,
    artifactPaths,
  }: {
    name: string;
    logger: bunyan;
    artifactPaths: string[];
  }
): Promise<{ artifactId: string | null }> {
  const { localPath, filename, size } = await prepareArtifactsForUploadAsync(logger, artifactPaths);
  const name = _name || filename;

  try {
    const { signedUrl: uploadSession, artifactId } = await createUploadSessionAsync(ctx, {
      filename,
      name,
      size,
    });

    await GCS.uploadWithSignedUrl({
      signedUrl: uploadSession,
      srcGeneratorAsync: async () => {
        return {
          stream: fs.createReadStream(localPath),
        };
      },
    });

    return { artifactId };
  } catch (err: any) {
    sentry.handleError('Failed to upload workflow artifact', err);
    throw new Error(`Failed to upload the file: ${err?.message}\n${err?.stack}`);
  }
}

export async function uploadWithAnalyticsAsync<TReturn>(
  fnAsync: () => Promise<TReturn>,
  analytics: Analytics
): Promise<TReturn> {
  try {
    const bucketKey = await fnAsync();
    analytics.logEvent(Event.ARTIFACT_UPLOAD_SUCCESS, {});
    return bucketKey;
  } catch (err: any) {
    analytics.logEvent(Event.ARTIFACT_UPLOAD_FAIL, { reason: err?.message });
    throw err;
  }
}

export async function prepareArtifactsForUploadAsync(
  logger: bunyan,
  artifactPaths: string[]
): Promise<{ localPath: string; suffix: string; filename: string; size: number }> {
  if (artifactPaths.length === 1 && !(await fs.lstat(artifactPaths[0])).isDirectory()) {
    const [localPath] = artifactPaths;
    const suffix = path.extname(localPath);
    const stats = await fs.stat(localPath);
    return { localPath, suffix, filename: path.basename(localPath), size: stats.size };
  } else {
    const parentDir = artifactPaths.reduce(
      (acc, item) => getCommonParentDir(acc, item),
      artifactPaths[0]
    );
    const relativePathsToArchive = artifactPaths.map((absolute) =>
      path.relative(parentDir, absolute)
    );

    logger.info('Archiving artifacts');
    const localPath = path.join(config.workingdir, 'artifacts.tar.gz');
    await tar.c(
      {
        gzip: true,
        file: localPath,
        cwd: parentDir,
      },
      relativePathsToArchive
    );
    const suffix = '.tar.gz';
    const stats = await fs.stat(localPath);
    return { localPath, suffix, filename: path.basename(localPath), size: stats.size };
  }
}

function getCommonParentDir(path1: string, path2: string): string {
  const normalizedPath1 = path.normalize(path1);
  const normalizedPath2 = path.normalize(path2);
  let current = path.dirname(normalizedPath1);
  while (current !== '/') {
    if (normalizedPath2.startsWith(current)) {
      return current;
    }
    current = path.dirname(current);
  }
  return '/';
}

async function createUploadSessionAsync(
  ctx: BuildContext,
  { filename, name, size }: { filename: string; name: string; size: number }
): Promise<{
  bucketKey: string;
  signedUrl: GCS.SignedUrl;
  storageType: ArchiveSourceType;
  artifactId: string | null;
}> {
  const workflowJobId = ctx.env.__WORKFLOW_JOB_ID;
  const buildId = ctx.env.EAS_BUILD_ID;

  if (!workflowJobId && !buildId) {
    throw new Error('Failed to create upload session - the env variables are not set.');
  }

  const robotAccessToken = ctx.job.secrets?.robotAccessToken;
  if (!robotAccessToken) {
    throw new Error('Failed to create upload session - the robot access token is not set');
  }

  let responseResult;
  if (ctx.job.platform) {
    responseResult = await asyncResult(
      turtleFetch(
        new URL(`turtle-builds/${buildId}/upload-sessions/`, config.wwwApiV2BaseUrl).toString(),
        'POST',
        // 'name' is ignored by Turtle Build router, but provide it for potential use for telemetry, etc.
        {
          json: { filename, name, size },
          headers: {
            Authorization: `Bearer ${robotAccessToken}`,
          },
          shouldThrowOnNotOk: false,
        }
      )
    );
  } else {
    responseResult = await asyncResult(
      turtleFetch(
        new URL(`workflows/${workflowJobId}/upload-sessions/`, config.wwwApiV2BaseUrl).toString(),
        'POST',
        {
          json: { filename, name, size },
          headers: {
            Authorization: `Bearer ${robotAccessToken}`,
          },
          shouldThrowOnNotOk: false,
        }
      )
    );
  }

  if (!responseResult.ok) {
    if (!(responseResult.reason instanceof TurtleFetchError)) {
      throw responseResult.reason;
    }

    const response = responseResult.reason.response;
    const textResult = await asyncResult(response.text());
    throw new Error(`Unexpected response from server (${response.status}): ${textResult.value}`);
  }

  const jsonResult = await asyncResult(responseResult.value.json());
  if (!jsonResult.ok) {
    throw new ErrorWithMetadata(`Malformed response from server: ${jsonResult.reason}.`, {
      text_base64: Buffer.from(
        (await asyncResult(responseResult.value.text())).value ?? ''
      ).toString('base64'),
    });
  }

  const dataResult = z
    .union([
      z.object({
        data: z.object({
          id: z.string().optional(),
          bucketKey: z.string(),
          url: z.string(),
          headers: z.record(z.string(), z.string()),
          storageType: z.enum(ArchiveSourceType),
        }),
      }),
      z.object({
        errors: z.array(z.object({ code: z.string(), message: z.string() })),
      }),
    ])
    .safeParse(jsonResult.value);

  if (!dataResult.success) {
    throw new ErrorWithMetadata(
      `Malformed data from server: ${z.prettifyError(dataResult.error)}.`,
      { response_base64: Buffer.from(JSON.stringify(jsonResult.value)).toString('base64') }
    );
  }

  if ('errors' in dataResult.data) {
    const codes = dataResult.data.errors.map((error) => error.code).join(', ');
    const messages = `${dataResult.data.errors.map((error) => error.message).join(' ')}`;
    throw new ErrorWithMetadata(`Error response from server: ${codes}. ${messages}`, {
      response_base64: Buffer.from(JSON.stringify(jsonResult.value)).toString('base64'),
    });
  }

  return {
    artifactId: dataResult.data.data.id ?? null,
    bucketKey: dataResult.data.data.bucketKey,
    signedUrl: { url: dataResult.data.data.url, headers: dataResult.data.data.headers },
    storageType: dataResult.data.data.storageType,
  };
}

async function saveArtifactAsync(
  ctx: BuildContext,
  {
    bucketKey,
    type,
    storageType,
  }: {
    bucketKey: string;
    type: 'applicationArchive' | 'buildArtifacts';
    storageType: ArchiveSourceType | null;
  }
): Promise<void> {
  nullthrows(storageType, 'Missing storage type for build artifacts');
  const workflowJobId = ctx.env.__WORKFLOW_JOB_ID;
  const buildId = ctx.env.EAS_BUILD_ID;

  if (!workflowJobId && !buildId) {
    throw new Error('Failed to save artifact - the env variables are not set.');
  }

  const robotAccessToken = ctx.job.secrets?.robotAccessToken;
  if (!robotAccessToken) {
    throw new Error('Failed to save artifact - the robot access token is not set');
  }

  let responseResult;
  if (ctx.job.platform) {
    responseResult = await asyncResult(
      turtleFetch(
        new URL(`turtle-builds/${buildId}/artifacts/`, config.wwwApiV2BaseUrl).toString(),
        'POST',
        {
          json: { type, source: { bucketKey, type: storageType } },
          headers: {
            Authorization: `Bearer ${robotAccessToken}`,
          },
        }
      )
    );
  } else {
    responseResult = await asyncResult(
      turtleFetch(
        new URL(`workflows/${workflowJobId}/artifacts/`, config.wwwApiV2BaseUrl).toString(),
        'POST',
        {
          json: { type, source: { bucketKey, type: storageType } },
          headers: {
            Authorization: `Bearer ${robotAccessToken}`,
          },
        }
      )
    );
  }

  if (!responseResult.ok) {
    if (!(responseResult.reason instanceof TurtleFetchError)) {
      throw responseResult.reason;
    }

    const response = responseResult.reason.response;
    const textResult = await asyncResult(response.text());
    throw new Error(`Unexpected response from server (${response.status}): ${textResult.value}`);
  }
}
