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

export function createLaunchApplicationFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'launch_application',
    name: 'Launch application',
    __metricsId: 'eas/launch_application',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'artifact_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async ({ global, logger }, { inputs, env }) => {
      const artifactPath = z.string().min(1).parse(inputs.artifact_path.value);
      await launchApplicationAsync({
        artifactPath,
        runtimePlatform: global.runtimePlatform,
        env,
        logger,
      });
    },
  });
}

export async function launchApplicationAsync({
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
      'EAS_LAUNCH_APPLICATION_INVALID_ARTIFACT',
      `Build artifact does not exist at ${artifactPath}.`,
      { cause: err }
    );
  });

  if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
    if (path.extname(artifactPath) !== '.app' || !artifactStat.isDirectory()) {
      throw new UserError(
        'EAS_LAUNCH_APPLICATION_INVALID_ARTIFACT',
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
        'EAS_LAUNCH_APPLICATION_MISSING_IDENTIFIER',
        `Could not read CFBundleIdentifier from ${infoPlistPath}.`
      );
    }

    logger.info(`Launching ${bundleIdentifier}.`);
    await spawn('xcrun', ['simctl', 'launch', 'booted', bundleIdentifier], { env, logger });
    return;
  }

  if (path.extname(artifactPath) !== '.apk' || !artifactStat.isFile()) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_INVALID_ARTIFACT',
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
      'EAS_LAUNCH_APPLICATION_MISSING_IDENTIFIER',
      `Could not read a launchable Android application from ${artifactPath}.`
    );
  }

  logger.info(`Launching ${packageName}.`);
  await spawn('adb', ['shell', 'am', 'start', '-n', `${packageName}/${activityName}`], {
    env,
    logger,
  });
}
