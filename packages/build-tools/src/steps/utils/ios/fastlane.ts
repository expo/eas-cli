import path from 'path';

import { bunyan } from '@expo/logger';
import spawn, { SpawnResult } from '@expo/turtle-spawn';
import { BuildStepEnv } from '@expo/steps';

import { COMMON_FASTLANE_ENV } from '../../../common/fastlane';

import { XcodeBuildLogger } from './xcpretty';

export async function runFastlaneGym({
  workingDir,
  logger,
  buildLogsDirectory,
  env,
  extraEnv,
}: {
  workingDir: string;
  logger: bunyan;
  buildLogsDirectory: string;
  env: BuildStepEnv;
  extraEnv?: BuildStepEnv;
}): Promise<void> {
  const buildLogger = new XcodeBuildLogger(logger, workingDir);
  void buildLogger.watchLogFiles(buildLogsDirectory);
  try {
    await runFastlane(['gym'], {
      cwd: path.join(workingDir, 'ios'),
      logger,
      env,
      extraEnv,
    });
  } finally {
    await buildLogger.flush();
  }
}

export async function runFastlane(
  fastlaneArgs: string[],
  {
    logger,
    env,
    cwd,
    extraEnv,
  }: {
    logger?: bunyan;
    env?: BuildStepEnv;
    cwd?: string;
    extraEnv?: BuildStepEnv;
  } = {}
): Promise<SpawnResult> {
  return await spawn('fastlane', fastlaneArgs, {
    env: {
      ...COMMON_FASTLANE_ENV,
      ...(env ?? process.env),
      ...extraEnv,
    },
    logger,
    cwd,
  });
}
