import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn, { SpawnResult } from '@expo/turtle-spawn';
import path from 'path';

import { COMMON_FASTLANE_ENV } from '../../../common/fastlane';
import { XcodeBuildLogger } from '../../../common/xcpretty';
import * as CompilationCache from '../../../ios/compilationCache';

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
  const workspacePath = path.join(workingDir, 'ios');
  const derivedDataPath = path.join(workspacePath, 'build');
  // When caching is enabled, this also sets GYM_DERIVED_DATA_PATH so Fastlane
  // and the cache restore/save operations use this exact directory.
  const compilationCacheEnv = await CompilationCache.prepareXcodeCompilationCacheEnvAsync({
    derivedDataPath,
    env,
    logger,
  });
  const buildLogger = new XcodeBuildLogger(logger, workingDir);
  void buildLogger.watchLogFiles(buildLogsDirectory);
  try {
    await runFastlane(['gym'], {
      cwd: workspacePath,
      logger,
      env,
      extraEnv: { ...extraEnv, ...compilationCacheEnv },
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
