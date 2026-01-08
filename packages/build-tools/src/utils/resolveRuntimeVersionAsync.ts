import { ExpoConfig } from '@expo/config';
import { Updates } from '@expo/config-plugins';
import { bunyan } from '@expo/logger';
import { Workflow } from '@expo/eas-build-job';
import { BuildStepEnv } from '@expo/steps';

import { ExpoUpdatesCLIModuleNotFoundError, expoUpdatesCommandAsync } from './expoUpdatesCli';
import { isModernExpoUpdatesCLIWithRuntimeVersionCommandSupported } from './expoUpdates';

export async function resolveRuntimeVersionAsync({
  exp,
  platform,
  workflow,
  projectDir,
  logger,
  expoUpdatesPackageVersion,
  env,
}: {
  exp: ExpoConfig;
  platform: 'ios' | 'android';
  workflow: Workflow;
  projectDir: string;
  logger: bunyan;
  expoUpdatesPackageVersion: string;
  env: BuildStepEnv;
}): Promise<{
  runtimeVersion: string | null;
  fingerprintSources: object[] | null;
} | null> {
  if (!isModernExpoUpdatesCLIWithRuntimeVersionCommandSupported(expoUpdatesPackageVersion)) {
    logger.debug('Using expo-updates config plugin for runtime version resolution');
    // fall back to the previous behavior (using the @expo/config-plugins eas-cli dependency rather
    // than the versioned @expo/config-plugins dependency in the project)
    return {
      runtimeVersion: await Updates.getRuntimeVersionNullableAsync(projectDir, exp, platform),
      fingerprintSources: null,
    };
  }

  try {
    logger.debug('Using expo-updates runtimeversion:resolve CLI for runtime version resolution');

    const extraArgs = logger.debug() ? ['--debug'] : [];

    const resolvedRuntimeVersionJSONResult = await expoUpdatesCommandAsync(
      projectDir,
      ['runtimeversion:resolve', '--platform', platform, '--workflow', workflow, ...extraArgs],
      {
        env,
      }
    );
    const runtimeVersionResult = JSON.parse(resolvedRuntimeVersionJSONResult);

    logger.debug('runtimeversion:resolve output:');
    logger.debug(resolvedRuntimeVersionJSONResult);

    return {
      runtimeVersion: runtimeVersionResult.runtimeVersion ?? null,
      fingerprintSources: runtimeVersionResult.fingerprintSources ?? null,
    };
  } catch (e: any) {
    // if expo-updates is not installed, there's no need for a runtime version in the build
    if (e instanceof ExpoUpdatesCLIModuleNotFoundError) {
      logger.error(
        `Error when resolving runtime version using expo-updates runtimeversion:resolve CLI: ${e.message}`
      );
      return null;
    }
    throw e;
  }
}
