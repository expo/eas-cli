import { Android, BuildJob, Ios, Platform } from '@expo/eas-build-job';
import { PipeMode } from '@expo/logger';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import StreamZip from 'node-stream-zip';

import { findArtifacts } from './artifacts';
import { runEasCliCommand } from './easCli';
import { resolveArtifactPath } from '../ios/resolve';
import { BuildContext } from '../context';

export async function uploadEmbeddedBundleAsync(ctx: BuildContext<BuildJob>): Promise<void> {
  const { platform } = ctx.job;
  const channel = ctx.job.updates?.channel;
  const projectDir = ctx.getReactNativeProjectDirectory();

  const archivePattern =
    platform === Platform.IOS
      ? resolveArtifactPath(ctx as BuildContext<Ios.Job>)
      : ((ctx as BuildContext<Android.Job>).job.applicationArchivePath ??
        'android/app/build/outputs/**/*.{apk,aab}');

  const [archivePath] = await findArtifacts({
    rootDir: projectDir,
    patternOrPath: archivePattern,
    logger: null,
  }).catch(() => [] as string[]);

  if (!channel || !archivePath) {
    ctx.logger.warn(
      `Skipping embedded bundle upload: ${!channel ? 'no channel configured for this build profile' : 'build archive not found'}.`
    );
    ctx.markBuildPhaseHasWarnings();
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-embedded-bundle-'));
  const zip = new StreamZip.async({ file: archivePath });
  try {
    const entries = Object.values(await zip.entries());
    const bundleEntry = entries.find(e =>
      platform === Platform.IOS
        ? e.name.endsWith('/main.jsbundle')
        : e.name === 'assets/index.android.bundle'
    );
    const manifestEntry = entries.find(e =>
      platform === Platform.IOS
        ? e.name.includes('EXUpdates.bundle/app.manifest')
        : e.name === 'assets/app.manifest'
    );

    if (!bundleEntry || !manifestEntry) {
      ctx.logger.warn('Skipping embedded bundle upload: bundle or manifest not found in archive.');
      ctx.markBuildPhaseHasWarnings();
      return;
    }

    const bundleName = platform === Platform.IOS ? 'main.jsbundle' : 'index.android.bundle';
    const bundlePath = path.join(tmpDir, bundleName);
    const manifestPath = path.join(tmpDir, 'app.manifest');
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
    if (ctx.env.EAS_BUILD_ID) {
      args.push('--build-id', ctx.env.EAS_BUILD_ID);
    }
    await runEasCliCommand({
      args,
      options: {
        cwd: projectDir,
        env: ctx.env,
        logger: ctx.logger,
        mode: PipeMode.STDERR_ONLY_AS_STDOUT,
      },
    });
  } catch (err: any) {
    ctx.logger.warn({ err }, 'Failed to upload embedded bundle.');
    ctx.markBuildPhaseHasWarnings();
  } finally {
    await zip.close();
  }
}
