import { SystemError, UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import { Client } from '@urql/core';
import contentDisposition from 'content-disposition';
import { glob } from 'fast-glob';
import { graphql } from 'gql.tada';
import fetch from 'node-fetch';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import stream from 'stream';
import { promisify } from 'util';
import { z } from 'zod';
import bplistParser from 'bplist-parser';
import plist from 'plist';

import { CustomBuildContext } from '../../customBuildContext';
import { formatBytes } from '../../utils/artifacts';
import { decompressTarAsync, isFileTarGzAsync } from '../../utils/files';
import { retryOnDNSFailure } from '../../utils/retryOnDNSFailure';
import { pluralize } from '../../utils/strings';

const streamPipeline = promisify(stream.pipeline);

type DownloadBuildSource =
  | { buildId: string; applicationArchiveUrl?: never }
  | { buildId?: never; applicationArchiveUrl: string };

const BUILD_BY_ID_QUERY = graphql(`
  query DownloadBuildByIdQuery($buildId: ID!) {
    builds {
      byId(buildId: $buildId) {
        id
        platform
        artifacts {
          applicationArchiveUrl
        }
      }
    }
  }
`);

export function createDownloadBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'download_build',
    name: 'Download build',
    __metricsId: 'eas/download_build',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'build_id',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'application_archive_url',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'extensions',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        defaultValue: ['apk', 'aab', 'ipa', 'app'],
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'artifact_path',
        required: true,
      }),
    ],
    fn: async (stepsCtx, { inputs, outputs }) => {
      const { logger } = stepsCtx;

      const extensions = z.array(z.string()).parse(inputs.extensions.value);
      logger.info(`Expected extensions: [${extensions.join(', ')}]`);
      const buildId = inputs.build_id.value
        ? z.string().uuid().parse(inputs.build_id.value)
        : undefined;
      const applicationArchiveUrl = inputs.application_archive_url.value
        ? parseHttpApplicationArchiveUrl(inputs.application_archive_url.value)
        : undefined;

      let source: DownloadBuildSource;
      if (buildId) {
        if (applicationArchiveUrl) {
          throw new UserError(
            'EAS_DOWNLOAD_BUILD_INVALID_SOURCE',
            'Pass only one of build_id or application_archive_url.'
          );
        }
        source = { buildId };
      } else {
        if (!applicationArchiveUrl) {
          throw new UserError(
            'EAS_DOWNLOAD_BUILD_INVALID_SOURCE',
            'Pass build_id or application_archive_url.'
          );
        }
        source = { applicationArchiveUrl };
      }

      logger.info(
        buildId ? `Downloading build ${buildId}...` : `Downloading application archive...`
      );

      const { artifactPath } = await downloadBuildAsync({
        logger,
        ...source,
        graphqlClient: ctx.graphqlClient,
        robotAccessToken: stepsCtx.global.staticContext.job.secrets?.robotAccessToken ?? null,
        extensions,
      });

      outputs.artifact_path.set(artifactPath);
    },
  });
}

async function fetchApplicationArchiveUrlAsync({
  buildId,
  graphqlClient,
}: {
  buildId: string;
  graphqlClient: Client;
}): Promise<string> {
  const result = await graphqlClient.query(BUILD_BY_ID_QUERY, { buildId }).toPromise();

  if (result.error) {
    const { error } = result;
    const message = `Could not fetch build ${buildId}: ${error.message}`;

    throw error.networkError || result.error.response?.status >= 500
      ? new SystemError(message, { cause: error })
      : new UserError('EAS_DOWNLOAD_BUILD_FETCH_FAILED', message, { cause: error });
  }

  const applicationArchiveUrl = result.data?.builds.byId?.artifacts?.applicationArchiveUrl;
  if (!applicationArchiveUrl) {
    throw new UserError(
      'EAS_DOWNLOAD_BUILD_NO_APPLICATION_ARCHIVE',
      'Build does not have an application archive url'
    );
  }

  return applicationArchiveUrl;
}

export async function downloadBuildAsync(
  params: DownloadBuildSource & {
    logger: bunyan;
    graphqlClient: Client;
    robotAccessToken: string | null;
    extensions: string[];
  }
): Promise<{ artifactPath: string }> {
  const { logger, graphqlClient, robotAccessToken, extensions } = params;

  let downloadUrl: string;
  let headers: { Authorization: string } | undefined;
  if (params.applicationArchiveUrl) {
    if (params.buildId) {
      throw new UserError(
        'EAS_DOWNLOAD_BUILD_INVALID_SOURCE',
        'Pass only one of buildId or applicationArchiveUrl.'
      );
    }
    downloadUrl = parseHttpApplicationArchiveUrl(params.applicationArchiveUrl);
    headers = undefined;
  } else if (params.buildId) {
    const buildId = z.string().uuid().parse(params.buildId);
    downloadUrl = await fetchApplicationArchiveUrlAsync({ buildId, graphqlClient });
    headers = robotAccessToken ? { Authorization: `Bearer ${robotAccessToken}` } : undefined;
  } else {
    throw new UserError(
      'EAS_DOWNLOAD_BUILD_INVALID_SOURCE',
      'Pass buildId or applicationArchiveUrl.'
    );
  }

  const downloadDestinationDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'download_build-downloaded-')
  );

  const response = await retryOnDNSFailure(fetch)(downloadUrl, { headers });

  if (!response.ok) {
    const textResult = await asyncResult(response.text());
    throw new Error(`Unexpected response from server (${response.status}): ${textResult.value}`);
  }

  const archiveFilename = resolveArchiveFilename({ response, extensions });
  const archivePath = path.join(downloadDestinationDirectory, archiveFilename);

  await streamPipeline(response.body, fs.createWriteStream(archivePath));

  const { size } = await fs.promises.stat(archivePath);

  logger.info(`Downloaded ${archivePath} (${formatBytes(size)} bytes).`);

  const isFileATarGzArchive = await isFileTarGzAsync(archivePath);

  if (!isFileATarGzArchive) {
    logger.info(`Artifact is not a .tar.gz archive, skipping decompression and validation.`);
    return { artifactPath: archivePath };
  }

  const extractionDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'download_build-extracted-')
  );
  await decompressTarAsync({
    archivePath,
    destinationDirectory: extractionDirectory,
  });

  const matchingFiles = await glob(`**/*.(${extensions.join('|')})`, {
    absolute: true,
    cwd: extractionDirectory,
    onlyFiles: false,
    onlyDirectories: false,
  });
  let matchingFilesRoot = extractionDirectory;

  if (
    matchingFiles.length === 0 &&
    extensions.includes('app') &&
    (await isIosAppBundleAsync(extractionDirectory))
  ) {
    const appBundlePath = `${extractionDirectory}.app`;
    await fs.promises.rename(extractionDirectory, appBundlePath);
    matchingFiles.push(appBundlePath);
    matchingFilesRoot = path.dirname(appBundlePath);
  }

  if (matchingFiles.length === 0) {
    throw new UserError(
      'EAS_DOWNLOAD_BUILD_NO_MATCHING_FILES',
      `No ${extensions.map(ext => `.${ext}`).join(', ')} entries found in the archive.`
    );
  }

  logger.info(
    `Found ${matchingFiles.length} matching ${pluralize(
      matchingFiles.length,
      'entry'
    )}:\n${matchingFiles.map(f => `- ${path.relative(matchingFilesRoot, f)}`).join('\n')}`
  );

  return { artifactPath: matchingFiles[0] };
}

async function isIosAppBundleAsync(directory: string): Promise<boolean> {
  try {
    const infoPlist = await fs.promises.readFile(path.join(directory, 'Info.plist'));
    const isBinaryPlist = infoPlist.subarray(0, 8).toString('ascii') === 'bplist00';
    const parsedInfoPlist = (
      isBinaryPlist
        ? bplistParser.parseBuffer(infoPlist)[0]
        : plist.parse(infoPlist.toString('utf8'))
    ) as Record<string, unknown> | undefined;

    return parsedInfoPlist?.CFBundlePackageType === 'APPL';
  } catch {
    return false;
  }
}

function parseHttpApplicationArchiveUrl(value: unknown): string {
  try {
    const applicationArchiveUrl = z.string().parse(value);
    const parsedUrl = new URL(applicationArchiveUrl);
    assert(parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:');
    return applicationArchiveUrl;
  } catch {
    throw new UserError(
      'EAS_DOWNLOAD_BUILD_INVALID_APPLICATION_ARCHIVE_URL',
      'application_archive_url must be a valid HTTP or HTTPS URL.'
    );
  }
}

function resolveArchiveFilename({
  response,
  extensions,
}: {
  response: Awaited<ReturnType<typeof fetch>>;
  extensions: string[];
}): string {
  const contentDispositionHeader = response.headers.get('content-disposition');
  let headerFilename: string | undefined;
  if (contentDispositionHeader) {
    try {
      headerFilename = contentDisposition.parse(contentDispositionHeader).parameters.filename;
    } catch {
      // Ignore malformed Content-Disposition headers and fall back to the response URL.
    }
  }

  const urlFilename = path.basename(new URL(response.url).pathname);
  let archiveFilename = path.basename(headerFilename ?? urlFilename ?? '');
  if (!archiveFilename || archiveFilename === '.' || archiveFilename === '..') {
    archiveFilename = 'application';
  }
  if (!path.extname(archiveFilename) && extensions.length === 1) {
    archiveFilename = `${archiveFilename}.${extensions[0]}`;
  }

  // URL and header filenames may contain percent-encoded or unsafe filesystem characters.
  return archiveFilename.replace(/([^a-z0-9.-]+)/gi, '_');
}
