import { Android, Env, Job, Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import assert from 'assert';
import fs from 'fs-extra';
import path from 'path';

import { BuildContext } from '../context';
import { getParentAndDescendantProcessPidsAsync } from '../utils/processes';

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

  const spawnPromise = spawn('bash', ['-c', `./gradlew ${gradleCommand} --profile ${verboseFlag}`], {
    cwd: androidDir,
    logger,
    lineTransformer: (line?: string) => {
      if (!line || /^\.+$/.exec(line)) {
        return null;
      } else {
        return line;
      }
    },
    env: { ...ctx.env, ...extraEnv, ...resolveVersionOverridesEnvs(ctx), LC_ALL: 'C.UTF-8' },
  });
  if (ctx.env.EAS_BUILD_RUNNER === 'eas-build' && process.platform === 'linux') {
    adjustOOMScore(spawnPromise, logger);
  }

  await spawnPromise;
}

/**
 * OOM Killer sometimes kills worker server while build is exceeding memory limits.
 * `oom_score_adj` is a value between -1000 and 1000 and it defaults to 0.
 * It defines which process is more likely to get killed (higher value more likely).
 *
 * This function sets oom_score_adj for Gradle process and all its child processes.
 */
function adjustOOMScore(spawnPromise: SpawnPromise<SpawnResult>, logger: bunyan): void {
  setTimeout(
    async () => {
      try {
        assert(spawnPromise.child.pid);
        const pids = await getParentAndDescendantProcessPidsAsync(spawnPromise.child.pid);
        await Promise.all(
          pids.map(async (pid: number) => {
            // Value 800 is just a guess here. It's probably higher than most other
            // process. I didn't want to set it any higher, because I'm not sure if OOM Killer
            // can start killing processes when there is still enough memory left.
            const oomScoreOverride = 800;
            await fs.writeFile(`/proc/${pid}/oom_score_adj`, `${oomScoreOverride}\n`);
          })
        );
      } catch (err: any) {
        logger.debug({ err, stderr: err?.stderr }, 'Failed to override oom_score_adj');
      }
    },
    // Wait 20 seconds to make sure all child processes are started
    20000
  );
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

export interface GradleProfileTask {
  path: string;
  durationMs: number;
  result: string;
}

export async function parseGradleProfile(androidDir: string): Promise<GradleProfileTask[] | null> {
  const profileDir = path.join(androidDir, 'build', 'reports', 'profile');
  if (!(await fs.pathExists(profileDir))) {
    return null;
  }

  const files = await fs.readdir(profileDir);
  const profileFile = files.filter((f) => f.endsWith('.html')).sort().pop();
  if (!profileFile) {
    return null;
  }

  const html = await fs.readFile(path.join(profileDir, profileFile), 'utf8');

  const tab4Match = html.match(/id="tab4"[\s\S]*?<\/table>/);
  if (!tab4Match) {
    return null;
  }

  const taskSection = tab4Match[0];
  const tasks: GradleProfileTask[] = [];
  const rowRegex = /<tr>\s*<td class="indentPath">(.*?)<\/td>\s*<td class="numeric">(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<\/tr>/g;

  let match;
  while ((match = rowRegex.exec(taskSection)) !== null) {
    tasks.push({
      path: match[1],
      durationMs: parseDurationToMs(match[2]),
      result: match[3] || 'executed',
    });
  }

  return tasks;
}

function parseDurationToMs(duration: string): number {
  let totalMs = 0;

  const daysMatch = duration.match(/(\d+)d/);
  if (daysMatch) {
    totalMs += parseInt(daysMatch[1], 10) * 86400000;
  }

  const hoursMatch = duration.match(/(\d+)h/);
  if (hoursMatch) {
    totalMs += parseInt(hoursMatch[1], 10) * 3600000;
  }

  const minsMatch = duration.match(/(\d+)m(?!\s*s)/);
  if (minsMatch) {
    totalMs += parseInt(minsMatch[1], 10) * 60000;
  }

  const secsMatch = duration.match(/([\d.]+)s$/);
  if (secsMatch) {
    totalMs += Math.round(parseFloat(secsMatch[1]) * 1000);
  }

  const msMatch = duration.match(/([\d.]+)ms$/);
  if (msMatch) {
    totalMs += Math.round(parseFloat(msMatch[1]));
  }

  return totalMs;
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
