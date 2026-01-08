import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepEnv,
  BuildStepGlobalContext,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';

export function createInstallMaestroBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_maestro',
    name: 'Install Maestro',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'maestro_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'maestro_version',
        required: false,
      }),
    ],
    fn: async ({ logger, global }, { inputs, env, outputs }) => {
      const requestedMaestroVersion = inputs.maestro_version.value as string | undefined;
      const { value: currentMaestroVersion } = await asyncResult(getMaestroVersion({ env }));

      // When not running in EAS Build VM, do not modify local environment.
      if (env.EAS_BUILD_RUNNER !== 'eas-build') {
        const currentIsJavaInstalled = await isJavaInstalled({ env });
        const currentIsIdbInstalled = await isIdbInstalled({ env });

        if (!currentIsJavaInstalled) {
          logger.warn(
            'It seems Java is not installed. It is required to run Maestro. If the job fails, this may be the reason.'
          );
          logger.info('');
        }

        if (!currentIsIdbInstalled) {
          logger.warn(
            'It seems IDB is not installed. Maestro requires it to run flows on iOS Simulator. If the job fails, this may be the reason.'
          );
          logger.info('');
        }

        if (!currentMaestroVersion) {
          logger.warn(
            'It seems Maestro is not installed. Please install Maestro manually and rerun the job.'
          );
          logger.info('');
        }

        // Guide is helpful in these two cases, it doesn't mention Java.
        if (!currentIsIdbInstalled || !currentMaestroVersion) {
          logger.warn(
            'For more info, check out Maestro installation guide: https://maestro.mobile.dev/getting-started/installing-maestro'
          );
        }

        if (currentMaestroVersion) {
          outputs.maestro_version.set(currentMaestroVersion);
          logger.info(`Maestro ${currentMaestroVersion} is ready.`);
        }

        return;
      }

      if (!(await isJavaInstalled({ env }))) {
        if (global.runtimePlatform === BuildRuntimePlatform.DARWIN) {
          logger.info('Installing Java');
          await installJavaFromGcs({ logger, env });
        } else {
          // We expect Java to be pre-installed on Linux images,
          // so this should only happen when running this step locally.
          // We don't need to support installing Java on local computers.
          throw new Error('Please install Java manually and rerun the job.');
        }
      }

      // IDB is only a requirement on macOS.
      if (
        global.runtimePlatform === BuildRuntimePlatform.DARWIN &&
        !(await isIdbInstalled({ env }))
      ) {
        logger.info('Installing IDB');
        await installIdbFromBrew({ logger, env });
      }

      // Skip installing if the input sets a specific Maestro version to install
      // and it is already installed which happens when developing on a local computer.
      if (
        !currentMaestroVersion ||
        (requestedMaestroVersion && requestedMaestroVersion !== currentMaestroVersion)
      ) {
        await installMaestro({
          version: requestedMaestroVersion,
          global,
          logger,
          env,
        });
      }

      const maestroVersionResult = await asyncResult(getMaestroVersion({ env }));
      if (!maestroVersionResult.ok) {
        logger.error(maestroVersionResult.reason, 'Failed to get Maestro version.');

        throw new Error('Failed to ensure Maestro is installed.');
      }

      logger.info(`Maestro ${maestroVersionResult.value} is ready.`);
      outputs.maestro_version.set(maestroVersionResult.value);
    },
  });
}

async function getMaestroVersion({ env }: { env: BuildStepEnv }): Promise<string> {
  const maestroVersion = await spawn('maestro', ['--version'], { stdio: 'pipe', env });
  return maestroVersion.stdout.trim();
}

async function installMaestro({
  global,
  version,
  logger,
  env,
}: {
  version?: string;
  logger: bunyan;
  global: BuildStepGlobalContext;
  env: BuildStepEnv;
}): Promise<void> {
  logger.info('Fetching install script');
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'install_maestro'));
  try {
    const installMaestroScriptResponse = await fetch('https://get.maestro.mobile.dev');
    const installMaestroScript = await installMaestroScriptResponse.text();
    const installMaestroScriptFilePath = path.join(tempDirectory, 'install_maestro.sh');
    await fs.promises.writeFile(installMaestroScriptFilePath, installMaestroScript, {
      mode: 0o777,
    });
    logger.info('Installing Maestro');
    assert(
      env.HOME,
      'Failed to infer directory to install Maestro in: $HOME environment variable is empty.'
    );
    const maestroDir = path.join(env.HOME, '.maestro');
    await spawn(installMaestroScriptFilePath, [], {
      logger,
      env: {
        ...env,
        MAESTRO_DIR: maestroDir,
        // _Not_ providing MAESTRO_VERSION installs latest.
        // MAESTRO_VERSION is used to interpolate the download URL like github.com/releases/cli-$MAESTRO_VERSION...
        MAESTRO_VERSION: version === 'latest' ? undefined : version,
      },
    });
    // That's where Maestro installs binary as of February 2024
    // I suspect/hope they don't change the location.
    const maestroBinDir = path.join(maestroDir, 'bin');
    global.updateEnv({
      ...global.env,
      PATH: `${global.env.PATH}:${maestroBinDir}`,
    });
    env.PATH = `${env.PATH}:${maestroBinDir}`;
    process.env.PATH = `${process.env.PATH}:${maestroBinDir}`;
  } finally {
    await fs.promises.rm(tempDirectory, { force: true, recursive: true });
  }
}

async function isIdbInstalled({ env }: { env: BuildStepEnv }): Promise<boolean> {
  try {
    await spawn('idb', ['-h'], { ignoreStdio: true, env });
    return true;
  } catch {
    return false;
  }
}

async function installIdbFromBrew({
  logger,
  env,
}: {
  logger: bunyan;
  env: BuildStepEnv;
}): Promise<void> {
  // Unfortunately our Mac images sometimes have two Homebrew
  // installations. We should use the ARM64 one, located in /opt/homebrew.
  const brewPath = '/opt/homebrew/bin/brew';
  const localEnv = {
    ...env,
    HOMEBREW_NO_AUTO_UPDATE: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1',
  };

  await spawn(brewPath, ['tap', 'facebook/fb'], {
    env: localEnv,
    logger,
  });
  await spawn(brewPath, ['install', 'idb-companion'], {
    env: localEnv,
    logger,
  });
}

async function isJavaInstalled({ env }: { env: BuildStepEnv }): Promise<boolean> {
  try {
    await spawn('java', ['-version'], { ignoreStdio: true, env });
    return true;
  } catch {
    return false;
  }
}

/**
 * Installs Java 17 from a file uploaded manually to GCS as cache.
 * Should not be run outside of EAS Build VMs not to break users' environments.
 */
async function installJavaFromGcs({
  logger,
  env,
}: {
  logger: bunyan;
  env: BuildStepEnv;
}): Promise<void> {
  const downloadUrl =
    'https://storage.googleapis.com/turtle-v2/zulu17.60.17-ca-jdk17.0.16-macosx_aarch64.dmg';
  const filename = path.basename(downloadUrl);
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'install_java'));
  const installerPath = path.join(tempDirectory, filename);
  const installerMountDirectory = path.join(tempDirectory, 'mountpoint');
  try {
    logger.info('Downloading Java installer');
    // This is simpler than piping body into a write stream with node-fetch.
    await spawn('curl', ['--output', installerPath, downloadUrl], { env });

    await fs.promises.mkdir(installerMountDirectory);
    logger.info('Mounting Java installer');
    await spawn(
      'hdiutil',
      ['attach', installerPath, '-noverify', '-mountpoint', installerMountDirectory],
      { env }
    );

    logger.info('Installing Java');
    await spawn(
      'sudo',
      [
        'installer',
        '-pkg',
        path.join(installerMountDirectory, 'Double-Click to Install Azul Zulu JDK 17.pkg'),
        '-target',
        '/',
      ],
      { env }
    );
  } finally {
    try {
      // We need to unmount to remove, otherwise we get "resource busy"
      await spawn('hdiutil', ['detach', installerMountDirectory], { env });
    } catch {}

    await fs.promises.rm(tempDirectory, { force: true, recursive: true });
  }
}
