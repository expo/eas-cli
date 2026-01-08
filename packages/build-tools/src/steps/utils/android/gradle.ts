import assert from 'assert';
import path from 'path';

import fs from 'fs-extra';
import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import { Android } from '@expo/eas-build-job';

export async function runGradleCommand({
  logger,
  gradleCommand,
  androidDir,
  env,
  extraEnv,
}: {
  logger: bunyan;
  gradleCommand: string;
  androidDir: string;
  env: BuildStepEnv;
  extraEnv?: BuildStepEnv;
}): Promise<void> {
  const verboseFlag = env['EAS_VERBOSE'] === '1' ? '--info' : '';

  logger.info(`Running 'gradlew ${gradleCommand} ${verboseFlag}' in ${androidDir}`);
  await fs.chmod(path.join(androidDir, 'gradlew'), 0o755);
  const spawnPromise = spawn('bash', ['-c', `./gradlew ${gradleCommand} ${verboseFlag}`], {
    cwd: androidDir,
    logger,
    lineTransformer: (line?: string) => {
      if (!line || /^\.+$/.exec(line)) {
        return null;
      } else {
        return line;
      }
    },
    env: { ...env, ...extraEnv },
  });
  if (env.EAS_BUILD_RUNNER === 'eas-build' && process.platform === 'linux') {
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

async function getChildrenPidsAsync(parentPids: number[]): Promise<number[]> {
  try {
    const result = await spawn('pgrep', ['-P', parentPids.join(',')], {
      stdio: 'pipe',
    });
    return result.stdout
      .toString()
      .split('\n')
      .map((i) => Number(i.trim()))
      .filter((i) => i);
  } catch {
    return [];
  }
}

async function getParentAndDescendantProcessPidsAsync(ppid: number): Promise<number[]> {
  const children = new Set<number>([ppid]);
  let shouldCheckAgain = true;
  while (shouldCheckAgain) {
    const pids = await getChildrenPidsAsync([...children]);
    shouldCheckAgain = false;
    for (const pid of pids) {
      if (!children.has(pid)) {
        shouldCheckAgain = true;
        children.add(pid);
      }
    }
  }
  return [...children];
}

export function resolveGradleCommand(job: Android.Job, command?: string): string {
  if (command) {
    return command;
  } else if (job.gradleCommand) {
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
