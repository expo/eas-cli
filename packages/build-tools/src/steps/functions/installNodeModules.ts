import path from 'path';

import { BuildFunction, BuildStepEnv, BuildStepContext } from '@expo/steps';

import {
  findPackagerRootDir,
  getPackageVersionFromPackageJson,
  resolvePackageManager,
  shouldUseFrozenLockfile,
} from '../../utils/packageManager';
import { installDependenciesAsync } from '../../common/installDependencies';
import { readPackageJson } from '../../utils/project';

export function createInstallNodeModulesBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_node_modules',
    name: 'Install node modules',
    __metricsId: 'eas/install_node_modules',
    fn: async (stepCtx, { env }) => {
      await installNodeModules(stepCtx, env);
    },
  });
}

export async function installNodeModules(
  stepCtx: BuildStepContext,
  env: BuildStepEnv
): Promise<void> {
  const { logger } = stepCtx;
  const packageManager = resolvePackageManager(stepCtx.workingDirectory);
  const packagerRunDir = findPackagerRootDir(stepCtx.workingDirectory);

  if (packagerRunDir !== stepCtx.workingDirectory) {
    const relativeReactNativeProjectDirectory = path.relative(
      stepCtx.global.projectTargetDirectory,
      stepCtx.workingDirectory
    );
    logger.info(
      `We detected that '${relativeReactNativeProjectDirectory}' is a ${packageManager} workspace`
    );
  }

  let packageJson = {};
  try {
    packageJson = readPackageJson(stepCtx.workingDirectory);
  } catch {
    logger.info(
      `Failed to read package.json, defaulting to installing dependencies with a frozen lockfile. You can use EAS_NO_FROZEN_LOCKFILE=1 to disable it.`
    );
  }

  const expoVersion =
    stepCtx.global.staticContext.metadata?.sdkVersion ??
    getPackageVersionFromPackageJson({
      packageJson,
      packageName: 'expo',
    });

  const reactNativeVersion =
    stepCtx.global.staticContext.metadata?.reactNativeVersion ??
    getPackageVersionFromPackageJson({
      packageJson,
      packageName: 'react-native',
    });

  const { spawnPromise } = await installDependenciesAsync({
    packageManager,
    env,
    logger: stepCtx.logger,
    cwd: packagerRunDir,
    useFrozenLockfile: shouldUseFrozenLockfile({
      env,
      sdkVersion: expoVersion,
      reactNativeVersion,
    }),
  });
  await spawnPromise;
}
