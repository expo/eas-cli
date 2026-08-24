import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export function createInstallBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_build',
    name: 'Install build',
    __metricsId: 'eas/install_build',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'artifact_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'application_identifier',
        required: true,
      }),
      BuildStepOutput.createProvider({
        id: 'activity_name',
        required: false,
      }),
    ],
    fn: async ({ global, logger }, { inputs, outputs, env }) => {
      const artifactPath = z.string().min(1).parse(inputs.artifact_path.value);
      const { applicationIdentifier, activityName } = await installBuildAsync({
        artifactPath,
        runtimePlatform: global.runtimePlatform,
        env,
        logger,
      });
      outputs.application_identifier.set(applicationIdentifier);
      if (activityName) {
        outputs.activity_name.set(activityName);
      }
    },
  });
}

export async function installBuildAsync({
  artifactPath,
  runtimePlatform,
  env,
  logger,
}: {
  artifactPath: string;
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<{ applicationIdentifier: string; activityName?: string }> {
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
    const applicationIdentifier = stdout.trim();
    if (!applicationIdentifier) {
      throw new UserError(
        'EAS_INSTALL_BUILD_MISSING_IDENTIFIER',
        `Could not read CFBundleIdentifier from ${infoPlistPath}.`
      );
    }

    logger.info(`Installing ${artifactPath} on the iOS Simulator.`);
    await spawn('xcrun', ['simctl', 'install', 'booted', artifactPath], { env, logger });
    return { applicationIdentifier };
  }

  if (path.extname(artifactPath) !== '.apk' || !artifactStat.isFile()) {
    throw new UserError(
      'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      'Android Emulator sessions require an .apk build artifact.'
    );
  }

  const { stdout } = await spawn('aapt2', ['dump', 'badging', artifactPath], {
    stdio: 'pipe',
    env,
  });
  const applicationIdentifier = stdout.match(/package: name='([^']+)'/)?.[1];
  const activityName = stdout.match(/launchable-activity: name='([^']+)'/)?.[1];
  if (!applicationIdentifier) {
    throw new UserError(
      'EAS_INSTALL_BUILD_MISSING_IDENTIFIER',
      `Could not read an Android application identifier from ${artifactPath}.`
    );
  }

  logger.info(`Installing ${artifactPath} on the Android Emulator.`);
  await spawn('adb', ['install', '-r', artifactPath], { env, logger });
  return { applicationIdentifier, activityName };
}
