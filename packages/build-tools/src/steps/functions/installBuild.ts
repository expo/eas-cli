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
    fn: async ({ global, logger }, { inputs, env }) => {
      const artifactPath = z.string().min(1).parse(inputs.artifact_path.value);
      await installBuildAsync({
        artifactPath,
        runtimePlatform: global.runtimePlatform,
        env,
        logger,
      });
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

    logger.info(`Installing ${artifactPath} on the iOS Simulator.`);
    await spawn('xcrun', ['simctl', 'install', 'booted', artifactPath], { env, logger });
    return;
  }

  if (path.extname(artifactPath) !== '.apk' || !artifactStat.isFile()) {
    throw new UserError(
      'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      'Android Emulator sessions require an .apk build artifact.'
    );
  }

  logger.info(`Installing ${artifactPath} on the Android Emulator.`);
  await spawn('adb', ['install', '-r', artifactPath], { env, logger });
}
