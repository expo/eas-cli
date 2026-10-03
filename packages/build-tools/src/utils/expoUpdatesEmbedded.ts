import { ExpoConfig } from '@expo/config';
import { Android, BuildJob, Env, Ios, Metadata, Platform } from '@expo/eas-build-job';
import { PipeMode, bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import StreamZip from 'node-stream-zip';
import semver from 'semver';

import { findArtifacts } from './artifacts';
import { runEasCliCommand } from './easCli';
import { isEASUpdateConfigured } from '../steps/utils/expoUpdates';

function parseBooleanEnvVar(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  return value !== '0' && value !== 'false';
}

/**
 * Uploading the embedded bundle is enabled by default for projects on SDK 58 and later, and can be
 * disabled by setting EAS_UPDATE_UPLOAD_EMBEDDED_BUNDLE to "0".
 *
 * On SDK 57 and below the feature is still experimental and off by default. Projects opt in by
 * setting EAS_UPDATE_EXPERIMENTAL_UPLOAD_EMBEDDED_BUNDLE to "1".
 */
export function shouldUploadEmbeddedBundle({
  env,
  metadata,
}: {
  env: Env;
  metadata?: Metadata | null;
}): boolean {
  const explicitFlag =
    parseBooleanEnvVar(env.EAS_UPDATE_UPLOAD_EMBEDDED_BUNDLE) ??
    parseBooleanEnvVar(env.EAS_UPDATE_EXPERIMENTAL_UPLOAD_EMBEDDED_BUNDLE);
  if (explicitFlag !== undefined) {
    return explicitFlag;
  }

  const sdkVersion = metadata?.sdkVersion;
  return !!sdkVersion && semver.satisfies(sdkVersion, '>=58');
}

export async function uploadEmbeddedBundleAsync({
  job,
  env,
  logger,
  projectDir,
  appConfig,
}: {
  job: BuildJob;
  env: Env;
  logger: bunyan;
  projectDir: string;
  appConfig: ExpoConfig;
}): Promise<'uploaded' | 'skipped' | 'failed'> {
  if (!isEASUpdateConfigured(appConfig, logger)) {
    return 'skipped';
  }

  if (job.developmentClient) {
    return 'skipped';
  }

  const { platform } = job;
  if (platform === Platform.IOS && (job as Ios.Job).simulator) {
    return 'skipped';
  }

  const channel = job.updates?.channel;
  if (!channel) {
    logger.warn('Skipping embedded bundle upload: no channel configured for this build profile.');
    return 'failed';
  }

  let archivePattern: string;
  if (platform === Platform.IOS) {
    archivePattern = (job as Ios.Job).applicationArchivePath ?? 'ios/build/*.ipa';
  } else if (platform === Platform.ANDROID) {
    archivePattern =
      (job as Android.Job).applicationArchivePath ?? 'android/app/build/outputs/**/*.{apk,aab}';
  } else {
    logger.warn(`Skipping embedded bundle upload: the ${platform} platform is not supported.`);
    return 'failed';
  }

  const [archivePath] = await findArtifacts({
    rootDir: projectDir,
    patternOrPath: archivePattern,
    logger: null,
  }).catch(() => [] as string[]);

  if (!archivePath) {
    logger.warn('Skipping embedded bundle upload: build archive not found.');
    return 'failed';
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-embedded-bundle-'));
  const bundleName = platform === Platform.IOS ? 'main.jsbundle' : 'index.android.bundle';
  const bundlePath = path.join(tmpDir, bundleName);
  const manifestPath = path.join(tmpDir, 'app.manifest');
  const zip = new StreamZip.async({ file: archivePath });
  try {
    const entries = Object.values(await zip.entries());
    const bundleEntry = entries.find(e =>
      platform === Platform.IOS
        ? e.name.endsWith('/main.jsbundle')
        : e.name.endsWith('assets/index.android.bundle')
    );
    const manifestEntry = entries.find(e =>
      platform === Platform.IOS
        ? e.name.includes('EXUpdates.bundle/app.manifest')
        : e.name.endsWith('assets/app.manifest')
    );

    if (!bundleEntry || !manifestEntry) {
      logger.warn('Skipping embedded bundle upload: bundle or manifest not found in archive.');
      return 'failed';
    }

    await zip.extract(bundleEntry.name, bundlePath);
    await zip.extract(manifestEntry.name, manifestPath);

    const args = [
      'update:embedded:upload',
      '--platform',
      platform,
      '--bundle',
      bundlePath,
      '--manifest',
      manifestPath,
      '--channel',
      channel,
      '--non-interactive',
    ];
    if (env.EAS_BUILD_ID) {
      args.push('--build-id', env.EAS_BUILD_ID);
    }
    await runEasCliCommand({
      args,
      options: {
        cwd: projectDir,
        env,
        logger,
        mode: PipeMode.STDERR_ONLY_AS_STDOUT,
      },
    });
    return 'uploaded';
  } catch (err: any) {
    logger.warn({ err }, 'Failed to upload embedded bundle.');
    return 'failed';
  } finally {
    await asyncResult(zip.close());
  }
}
