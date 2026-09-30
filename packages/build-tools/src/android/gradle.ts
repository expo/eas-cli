import { Android, Env, Job, Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';
import path from 'path';

import { BuildContext } from '../context';

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
  logger.info(`Running 'gradlew ${gradleCommand}' in ${androidDir}`);
  await fs.chmod(path.join(androidDir, 'gradlew'), 0o755);
  const verboseFlag = ctx.env['EAS_VERBOSE'] === '1' ? '--info' : '';
  const shouldResetOOMScore =
    ctx.env.EAS_BUILD_RUNNER === 'eas-build' && process.platform === 'linux';

  await spawn(
    'bash',
    [
      '-c',
      getGradleShellCommand({
        gradleCommand,
        oomScoreAdj: shouldResetOOMScore ? 0 : undefined,
        verboseFlag,
      }),
    ],
    {
      cwd: androidDir,
      logger,
      lineTransformer: (line?: string) => {
        if (!line || /^\.+$/.exec(line)) {
          return null;
        } else {
          return line;
        }
      },
      env: {
        ...ctx.env,
        ...extraEnv,
        ...resolveVersionOverridesEnvs(ctx),
        LC_ALL: 'C.UTF-8',
      },
    }
  );
}

export function getGradleShellCommand({
  gradleCommand,
  oomScoreAdj,
  verboseFlag,
}: {
  gradleCommand: string;
  oomScoreAdj?: number;
  verboseFlag: string;
}): string {
  const oomScoreAdjPrefix =
    oomScoreAdj === undefined ? '' : `echo ${oomScoreAdj} > /proc/$$/oom_score_adj || true; `;
  return `${oomScoreAdjPrefix}exec ./gradlew ${gradleCommand} --profile ${verboseFlag}`;
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
