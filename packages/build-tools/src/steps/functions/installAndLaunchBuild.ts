import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export function createInstallAndLaunchBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_and_launch_build',
    name: 'Install and launch build',
    __metricsId: 'eas/install_and_launch_build',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'artifact_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async ({ global, logger }, { inputs, env }) => {
      const artifactPath = z.string().min(1).parse(inputs.artifact_path.value);
      await installAndLaunchBuildAsync({
        artifactPath,
        runtimePlatform: global.runtimePlatform,
        env,
        logger,
      });
    },
  });
}

export async function installAndLaunchBuildAsync({
  artifactPath,
  runtimePlatform,
  env,
  logger,
}: {
  artifactPath: string;
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  const artifactStat = await fs.promises.stat(artifactPath).catch(err => {
    throw new UserError(
      'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      `Build artifact does not exist at ${artifactPath}.`,
      { cause: err }
    );
  });

  if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
    if (path.extname(artifactPath) !== '.app' || !artifactStat.isDirectory()) {
      throw new UserError(
        'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
        'iOS Simulator sessions require a .app build artifact.'
      );
    }

    const infoPlistPath = path.join(artifactPath, 'Info.plist');
    const { stdout } = await spawn(
      'plutil',
      ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlistPath],
      { stdio: 'pipe', env }
    );
    const bundleIdentifier = stdout.trim();
    if (!bundleIdentifier) {
      throw new UserError(
        'EAS_INSTALL_BUILD_MISSING_APP_IDENTIFIER',
        `Could not read CFBundleIdentifier from ${infoPlistPath}.`
      );
    }

    logger.info(`Installing ${bundleIdentifier} on the iOS Simulator.`);
    await spawn('xcrun', ['simctl', 'install', 'booted', artifactPath], { env, logger });
    logger.info(`Launching ${bundleIdentifier}.`);
    await spawn('xcrun', ['simctl', 'launch', 'booted', bundleIdentifier], { env, logger });
    return;
  }

  if (path.extname(artifactPath) !== '.apk' || !artifactStat.isFile()) {
    throw new UserError(
      'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      'Android Emulator sessions require an .apk build artifact.'
    );
  }

  const { stdout } = await spawn('aapt', ['dump', 'badging', artifactPath], {
    stdio: 'pipe',
    env,
  });
  const packageName = stdout.match(/package: name='([^']+)'/)?.[1];
  const activityName = stdout.match(/launchable-activity: name='([^']+)'/)?.[1];
  if (!packageName || !activityName) {
    throw new UserError(
      'EAS_INSTALL_BUILD_MISSING_APP_IDENTIFIER',
      `Could not read a launchable Android application from ${artifactPath}.`
    );
  }

  logger.info(`Installing ${packageName} on the Android Emulator.`);
  await spawn('adb', ['install', '-r', artifactPath], { env, logger });
  logger.info(`Launching ${packageName}.`);
  await spawn('adb', ['shell', 'am', 'start', '-n', `${packageName}/${activityName}`], {
    env,
    logger,
  });
}
