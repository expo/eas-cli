import { Android } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'fs-extra';
import path from 'path';

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
  const shouldResetOOMScore = env.EAS_BUILD_RUNNER === 'eas-build' && process.platform === 'linux';

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
        ...env,
        ...extraEnv,
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
