import { Android, BuildJob, Ios, Platform } from '@expo/eas-build-job';
import { BuildFunction, spawnAsync } from '@expo/steps';
import fs from 'fs-extra';
import { graphql } from 'gql.tada';
import path from 'node:path';

import { parseInfoPlistBuffer, readIpaInfoAsync } from './readIpaInfo';
import { CustomBuildContext } from '../../customBuildContext';
import { findArtifacts } from '../../utils/artifacts';

export function createReportResolvedVersionBuildFunction(
  ctx: CustomBuildContext<BuildJob>
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'report_resolved_version',
    name: 'Report resolved version',
    __metricsId: 'eas/report_resolved_version',
    fn: async (stepCtx) => {
      try {
        const { appVersion, appBuildVersion } =
          ctx.job.platform === Platform.IOS
            ? await extractIosVersionAsync(ctx, stepCtx.workingDirectory, stepCtx.logger)
            : await extractAndroidVersionAsync(ctx, stepCtx.workingDirectory, stepCtx.logger);

        if (!appVersion && !appBuildVersion) {
          stepCtx.logger.info('No resolved version found, skipping.');
          return;
        }

        stepCtx.logger.info(
          `Resolved version: ${appVersion ?? 'N/A'} (${appBuildVersion ?? 'N/A'})`
        );

        const buildId = ctx.env.EAS_BUILD_ID;
        if (!buildId) {
          stepCtx.logger.warn('EAS_BUILD_ID not set, cannot report resolved version.');
          return;
        }

        await reportResolvedVersionAsync(ctx, buildId, {
          appVersion,
          appBuildVersion,
        });

        stepCtx.logger.info('Reported resolved version to EAS.');
      } catch (err) {
        stepCtx.logger.warn('Failed to report resolved version (non-fatal):', err);
      }
    },
  });
}

async function extractIosVersionAsync(
  ctx: CustomBuildContext<BuildJob>,
  workingDirectory: string,
  logger: any
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const iosJob = ctx.job as Ios.Job;

  if (iosJob.simulator) {
    return await extractSimulatorAppVersionAsync(iosJob, workingDirectory, logger);
  }

  const artifactPattern = iosJob.applicationArchivePath ?? 'ios/build/*.ipa';
  const artifacts = await findArtifacts({
    rootDir: workingDirectory,
    patternOrPath: artifactPattern,
    logger,
  });

  if (artifacts.length === 0) {
    return {};
  }

  const ipaPath = artifacts[0];
  const ipaInfo = await readIpaInfoAsync(ipaPath);

  return {
    appVersion: ipaInfo.bundleShortVersion,
    appBuildVersion: ipaInfo.bundleVersion,
  };
}

async function extractSimulatorAppVersionAsync(
  iosJob: Ios.Job,
  workingDirectory: string,
  logger: any
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const artifactPattern =
    iosJob.applicationArchivePath ?? 'ios/build/Build/Products/*simulator/*.app';
  const artifacts = await findArtifacts({
    rootDir: workingDirectory,
    patternOrPath: artifactPattern,
    logger,
  });

  if (artifacts.length === 0) {
    return {};
  }

  const appPath = artifacts[0];
  const infoPlistPath = path.join(appPath, 'Info.plist');

  if (!(await fs.pathExists(infoPlistPath))) {
    return {};
  }

  const infoPlistBuffer = await fs.readFile(infoPlistPath);
  const infoPlist = parseInfoPlistBuffer(infoPlistBuffer);

  return {
    appVersion: typeof infoPlist.CFBundleShortVersionString === 'string'
      ? infoPlist.CFBundleShortVersionString
      : undefined,
    appBuildVersion: typeof infoPlist.CFBundleVersion === 'string'
      ? infoPlist.CFBundleVersion
      : undefined,
  };
}

async function extractAndroidVersionAsync(
  ctx: CustomBuildContext<BuildJob>,
  workingDirectory: string,
  logger: any
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const androidJob = ctx.job as Android.Job;
  const artifactPattern =
    androidJob.applicationArchivePath ?? 'android/app/build/outputs/**/*.{apk,aab}';
  const artifacts = await findArtifacts({
    rootDir: workingDirectory,
    patternOrPath: artifactPattern,
    logger,
  });

  if (artifacts.length === 0) {
    return {};
  }

  const artifactPath = artifacts[0];
  const ext = path.extname(artifactPath).toLowerCase();

  if (ext === '.apk') {
    return await extractVersionFromApkAsync(artifactPath);
  } else if (ext === '.aab') {
    return await extractVersionFromAabAsync(artifactPath);
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
  const result = await spawnAsync(
    'bundletool',
    ['dump', 'manifest', '--bundle', aabPath],
    { stdio: 'pipe' }
  );

  return parseManifestXml(result.stdout);
}

function parseAaptOutput(
  output: string
): { appVersion?: string; appBuildVersion?: string } {
  const versionNameMatch = output.match(/versionName='([^']+)'/);
  const versionCodeMatch = output.match(/versionCode='([^']+)'/);

  return {
    appVersion: versionNameMatch?.[1],
    appBuildVersion: versionCodeMatch?.[1],
  };
}

function parseManifestXml(
  xml: string
): { appVersion?: string; appBuildVersion?: string } {
  const versionNameMatch = xml.match(/android:versionName="([^"]+)"/);
  const versionCodeMatch = xml.match(/android:versionCode="([^"]+)"/);

  return {
    appVersion: versionNameMatch?.[1],
    appBuildVersion: versionCodeMatch?.[1],
  };
}

async function reportResolvedVersionAsync(
  ctx: CustomBuildContext<BuildJob>,
  buildId: string,
  {
    appVersion,
    appBuildVersion,
  }: {
    appVersion?: string;
    appBuildVersion?: string;
  }
): Promise<void> {
  const result = await ctx.graphqlClient
    .mutation(
      graphql(`
        mutation ReportResolvedVersionMutation(
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
        appVersion: appVersion ?? null,
        appBuildVersion: appBuildVersion ?? null,
      }
    )
    .toPromise();

  if (result.error) {
    throw result.error;
  }
}
