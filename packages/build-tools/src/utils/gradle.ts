import { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';
import path from 'path';

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
  const shouldAdjustOOMScore = env.EAS_BUILD_RUNNER === 'eas-build' && process.platform === 'linux';

  const spawnPromise = spawn(
    'bash',
    [
      '-c',
      getGradleShellCommand({
        gradleCommand,
        oomScoreAdj: shouldAdjustOOMScore ? 0 : undefined,
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
        ...env,
        ...extraEnv,
        LC_ALL: 'C.UTF-8',
      },
    }
  );
  await spawnPromise;
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
