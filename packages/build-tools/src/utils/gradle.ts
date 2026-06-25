import { bunyan } from '@expo/logger';
import spawn, { SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import assert from 'assert';
import fs from 'fs-extra';
import path from 'path';

import { getParentAndDescendantProcessPidsAsync } from './processes';

type GradleEnv = Record<string, string | undefined>;

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
  env: GradleEnv;
  extraEnv?: GradleEnv;
}): Promise<void> {
  const verboseFlag = env['EAS_VERBOSE'] === '1' ? '--info' : '';

  logger.info(`Running 'gradlew ${gradleCommand} ${verboseFlag}' in ${androidDir}`);
  await fs.chmod(path.join(androidDir, 'gradlew'), 0o755);

  const spawnPromise = spawn(
    'bash',
    ['-c', getGradleShellCommand({ gradleCommand, verboseFlag })],
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
        ...env,
        ...extraEnv,
        LC_ALL: 'C.UTF-8',
      },
    }
  );
  if (env.EAS_BUILD_RUNNER === 'eas-build' && process.platform === 'linux') {
    adjustOOMScore(spawnPromise, logger);
  }

  await spawnPromise;
}

export function getGradleShellCommand({
  gradleCommand,
  verboseFlag,
}: {
  gradleCommand: string;
  verboseFlag: string;
}): string {
  return `exec ./gradlew ${gradleCommand} --profile ${verboseFlag}`;
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
