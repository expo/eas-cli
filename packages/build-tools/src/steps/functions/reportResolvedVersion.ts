import { BuildJob, Platform } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  spawnAsync,
} from '@expo/steps';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs-extra';
import { Client } from '@urql/core';
import { graphql } from 'gql.tada';
import path from 'node:path';

import { parseInfoPlistBuffer, readIpaInfoAsync } from './readIpaInfo';
import { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';

export function createReportResolvedVersionBuildFunction(
  ctx: CustomBuildContext<BuildJob>
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'report_resolved_version',
    name: 'Report resolved version',
    __metricsId: 'eas/report_resolved_version',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'application_archive_path',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepCtx, { inputs }) => {
      try {
        const archivePathInput = inputs.application_archive_path.value as string | undefined;
        if (!archivePathInput) {
          stepCtx.logger.info('No application archive path provided, skipping.');
          return;
        }
        const archivePath = path.resolve(stepCtx.workingDirectory, archivePathInput);

        const buildId = ctx.env.EAS_BUILD_ID;
        if (!buildId) {
          stepCtx.logger.info('EAS_BUILD_ID not set, skipping.');
          return;
        }

        const { appVersion, appBuildVersion } =
          ctx.job.platform === Platform.IOS
            ? await extractIosVersionAsync(archivePath)
            : await extractAndroidVersionAsync(archivePath);

        if (!appVersion && !appBuildVersion) {
          stepCtx.logger.info('No resolved version found, skipping.');
          return;
        }

        stepCtx.logger.info(
          `Resolved version: ${appVersion ?? 'N/A'} (${appBuildVersion ?? 'N/A'})`
        );

        await updateResolvedVersionAsync(ctx.graphqlClient, buildId, {
          appVersion,
          appBuildVersion,
        });

        stepCtx.logger.info('Updated resolved version on EAS.');
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Failed to update resolved version', error);
        stepCtx.logger.warn({ err: error }, 'Failed to update resolved version (non-fatal)');
      }
    },
  });
}

export async function extractIosVersionAsync(
  archivePath: string
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const ext = path.extname(archivePath).toLowerCase();

  if (ext === '.app') {
    return await extractSimulatorAppVersionAsync(archivePath);
  }

  const ipaInfo = await readIpaInfoAsync(archivePath);
  return {
    appVersion: ipaInfo.bundleShortVersion,
    appBuildVersion: ipaInfo.bundleVersion,
  };
}

async function extractSimulatorAppVersionAsync(
  appPath: string
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const infoPlistPath = path.join(appPath, 'Info.plist');

  if (!(await fs.pathExists(infoPlistPath))) {
    return {};
  }

  const infoPlistBuffer = await fs.readFile(infoPlistPath);
  const infoPlist = parseInfoPlistBuffer(infoPlistBuffer);

  return {
    appVersion:
      typeof infoPlist.CFBundleShortVersionString === 'string'
        ? infoPlist.CFBundleShortVersionString
        : undefined,
    appBuildVersion:
      typeof infoPlist.CFBundleVersion === 'string' ? infoPlist.CFBundleVersion : undefined,
  };
}

export async function extractAndroidVersionAsync(
  archivePath: string
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const ext = path.extname(archivePath).toLowerCase();

  if (ext === '.apk') {
    return await extractVersionFromApkAsync(archivePath);
  } else if (ext === '.aab') {
    return await extractVersionFromAabAsync(archivePath);
  }

  return {};
}

async function extractVersionFromApkAsync(
  apkPath: string
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const result = await spawnAsync('aapt2', ['dump', 'badging', apkPath], {
    stdio: 'pipe',
  });

  return parseAaptOutput(result.stdout);
}

async function extractVersionFromAabAsync(
  aabPath: string
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const result = await spawnAsync('bundletool', ['dump', 'manifest', '--bundle', aabPath], {
    stdio: 'pipe',
  });

  return parseManifestXml(result.stdout);
}

export function parseAaptOutput(output: string): { appVersion?: string; appBuildVersion?: string } {
  // aapt2 does not escape apostrophes inside versionName, so stop at the next known
  // badging field (or the end of the line) rather than at the first closing quote.
  const versionNameMatch = output.match(
    /versionName='(.*?)'(?= platformBuildVersionName=| platformBuildVersionCode=| compileSdkVersion=|\s*$)/m
  );
  const versionCodeMatch = output.match(/versionCode='([^']+)'/);

  return {
    appVersion: versionNameMatch?.[1],
    appBuildVersion: versionCodeMatch?.[1],
  };
}

export function parseManifestXml(xml: string): { appVersion?: string; appBuildVersion?: string } {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xml);

  const manifest = parsed?.manifest;
  if (!manifest) {
    return {};
  }

  const versionName = manifest['@_android:versionName'];
  const versionCode = manifest['@_android:versionCode'];

  return {
    appVersion: versionName != null ? String(versionName) : undefined,
    appBuildVersion: versionCode != null ? String(versionCode) : undefined,
  };
}

export async function updateResolvedVersionAsync(
  graphqlClient: Client,
  buildId: string,
  {
    appVersion,
    appBuildVersion,
  }: {
    appVersion: string | undefined;
    appBuildVersion: string | undefined;
  }
): Promise<void> {
  const result = await graphqlClient
    .mutation(
      graphql(`
        mutation UpdateResolvedVersionMutation(
          $buildId: ID!
          $appVersion: String
          $appBuildVersion: String
        ) {
          build {
            updateBuildMetadata(
              buildId: $buildId
              metadata: {
                appVersion: $appVersion
                appBuildVersion: $appBuildVersion
              }
            ) {
              id
            }
          }
        }
      `),
      {
        buildId,
        appVersion,
        appBuildVersion,
      }
    )
    .toPromise();

  if (result.error) {
    throw result.error;
  }
}
