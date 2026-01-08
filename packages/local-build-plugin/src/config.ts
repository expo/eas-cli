import path from 'path';

import { v4 as uuidv4 } from 'uuid';
import envPaths from 'env-paths';
import { LoggerLevel } from '@expo/logger';

const { temp } = envPaths('eas-build-local');

const envWorkingdir = process.env.EAS_LOCAL_BUILD_WORKINGDIR;
const envSkipCleanup = process.env.EAS_LOCAL_BUILD_SKIP_CLEANUP;
const envSkipNativeBuild = process.env.EAS_LOCAL_BUILD_SKIP_NATIVE_BUILD;
const envArtifactsDir = process.env.EAS_LOCAL_BUILD_ARTIFACTS_DIR;
const envArtifactPath = process.env.EAS_LOCAL_BUILD_ARTIFACT_PATH;

if (
  process.env.EAS_LOCAL_BUILD_LOGGER_LEVEL &&
  !Object.values(LoggerLevel).includes(process.env.EAS_LOCAL_BUILD_LOGGER_LEVEL as LoggerLevel)
) {
  throw new Error(
    `Invalid value for EAS_LOCAL_BUILD_LOGGER_LEVEL, one of ${Object.values(LoggerLevel)
      .map((ll) => `"${ll}"`)
      .join(', ')} is expected`
  );
}
const envLoggerLevel = process.env.EAS_LOCAL_BUILD_LOGGER_LEVEL as LoggerLevel;

export default {
  workingdir: envWorkingdir ?? path.join(temp, uuidv4()),
  skipCleanup: envSkipCleanup === '1',
  skipNativeBuild: envSkipNativeBuild === '1',
  artifactsDir: envArtifactsDir ?? process.cwd(),
  artifactPath: envArtifactPath,
  logger: {
    defaultLoggerLevel: envLoggerLevel ?? LoggerLevel.INFO,
  },
};
