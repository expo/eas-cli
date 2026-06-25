import { Android, Env, Job, Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import path from 'path';

import { BuildContext } from '../context';
import { runGradleCommand as runGradleCommandInternal } from '../utils/gradle';

export async function ensureLFLineEndingsInGradlewScript<TJob extends Job>(
  ctx: BuildContext<TJob>
): Promise<void> {
  const gradlewPath = path.join(ctx.getReactNativeProjectDirectory(), 'android', 'gradlew');
  const gradlewContent = await fs.readFile(gradlewPath, 'utf8');
  if (gradlewContent.includes('\r')) {
    ctx.logger.info('Replacing CRLF line endings with LF in gradlew script');
    await fs.writeFile(gradlewPath, gradlewContent.replace(/\r\n/g, '\n'), 'utf8');
  }
}

export async function runGradleCommand(
  ctx: BuildContext<Job>,
  {
    logger,
    gradleCommand,
    androidDir,
    extraEnv,
  }: { logger: bunyan; gradleCommand: string; androidDir: string; extraEnv?: Env }
): Promise<void> {
  await runGradleCommandInternal({
    androidDir,
    env: {
      ...ctx.env,
      ...extraEnv,
      ...resolveVersionOverridesEnvs(ctx),
    },
    gradleCommand,
    logger,
  });
}

// Version envs should be set at the beginning of the build, but when building
// from github those values are resolved later.
function resolveVersionOverridesEnvs(ctx: BuildContext<Job>): Env {
  const extraEnvs: Env = {};
  if (
    ctx.job.platform === Platform.ANDROID &&
    ctx.job.version?.versionCode &&
    !ctx.env.EAS_BUILD_ANDROID_VERSION_CODE
  ) {
    extraEnvs.EAS_BUILD_ANDROID_VERSION_CODE = ctx.job.version.versionCode;
  }
  if (
    ctx.job.platform === Platform.ANDROID &&
    ctx.job.version?.versionName &&
    !ctx.env.EAS_BUILD_ANDROID_VERSION_NAME
  ) {
    extraEnvs.EAS_BUILD_ANDROID_VERSION_NAME = ctx.job.version.versionName;
  }
  return extraEnvs;
}

export function resolveGradleCommand(job: Android.Job): string {
  if (job.gradleCommand) {
    return job.gradleCommand;
  } else if (job.developmentClient) {
    return ':app:assembleDebug';
  } else if (!job.buildType) {
    return ':app:bundleRelease';
  } else if (job.buildType === Android.BuildType.APK) {
    return ':app:assembleRelease';
  } else {
    return ':app:bundleRelease';
  }
}
