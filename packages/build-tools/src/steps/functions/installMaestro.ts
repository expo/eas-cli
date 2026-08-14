import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
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
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { MaestroBackend, resolveMaestroBackend } from './maestroBackend';
import { Datadog } from '../../datadog';

const MAESTRO_RUNNER_WDA_CACHE_URL =
  'https://storage.googleapis.com/turtle-v2/maestro-runner-wda-cache';

export function createInstallMaestroBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_maestro',
    name: 'Install Maestro',
    __metricsId: 'eas/install_maestro',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'maestro_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'backend',
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
      const backend = resolveMaestroBackend({
        input: inputs.backend.value,
        env,
      });
      const requestedVersion = inputs.maestro_version.value as string | undefined;
      const { value: currentMaestroVersion } = await asyncResult(
        getMaestroVersion({ env, backend })
      );

      // When not running in EAS Build VM, do not modify local environment.
      if (env.EAS_BUILD_RUNNER !== 'eas-build') {
        const needsToInstallJava = backend === 'maestro' && !(await isJavaInstalled({ env }));
        const needsToInstallIdb = backend === 'maestro' && !(await isIdbInstalled({ env }));

        if (needsToInstallJava) {
          logger.warn(
            'It seems Java is not installed. It is required to run Maestro. If the job fails, this may be the reason.'
          );
          logger.info('');
        }

        if (needsToInstallIdb) {
          logger.warn(
            'It seems IDB is not installed. Maestro requires it to run flows on iOS Simulator. If the job fails, this may be the reason.'
          );
          logger.info('');
        }

        if (!currentMaestroVersion) {
          logger.warn(
            `It seems ${backend} is not installed. Please install it manually and rerun the job.`
          );
          logger.info('');
        }

        // Guide is helpful in these two cases, it doesn't mention Java.
        if (backend === 'maestro' && (needsToInstallIdb || !currentMaestroVersion)) {
          logger.warn(
            'For more info, check out Maestro installation guide: https://maestro.mobile.dev/getting-started/installing-maestro'
          );
        } else if (backend === 'maestro-runner' && !currentMaestroVersion) {
          logger.warn(
            'For more info, check out maestro-runner installation guide: https://github.com/devicelab-dev/maestro-runner#install'
          );
        }

        if (currentMaestroVersion) {
          outputs.maestro_version.set(currentMaestroVersion);
          logger.info(`${backend} ${currentMaestroVersion} is ready.`);
        }

        return;
      }

      const needsToInstallJava = backend === 'maestro' && !(await isJavaInstalled({ env }));
      if (needsToInstallJava) {
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
      const needsToInstallIdb =
        backend === 'maestro' &&
        global.runtimePlatform === BuildRuntimePlatform.DARWIN &&
        !(await isIdbInstalled({ env }));
      if (needsToInstallIdb) {
        logger.info('Installing IDB');
        await installIdbFromBrew({ logger, env });
      }

      // Skip installing if the input sets a specific Maestro version to install
      // and it is already installed which happens when developing on a local computer.
      if (
        !currentMaestroVersion ||
        (requestedVersion && requestedVersion !== currentMaestroVersion)
      ) {
        switch (backend) {
          case 'maestro':
            await installMaestro({ version: requestedVersion, global, logger, env });
            break;
          case 'maestro-runner':
            await installMaestroRunner({ version: requestedVersion, global, logger, env });
            break;
        }
      }

      const maestroVersionResult = await asyncResult(getMaestroVersion({ env, backend }));
      if (!maestroVersionResult.ok) {
        logger.error(maestroVersionResult.reason, 'Failed to get Maestro version.');

        throw new Error(`Failed to ensure ${backend} is installed.`);
      }

      if (backend === 'maestro-runner' && global.runtimePlatform === BuildRuntimePlatform.DARWIN) {
        await installMaestroRunnerWdaCache({
          logger,
          env,
        });
      }

      logger.info(`${backend} ${maestroVersionResult.value} is ready.`);
      outputs.maestro_version.set(maestroVersionResult.value);

      Datadog.distribution('eas.maestro.install', 1, {
        maestro_version: maestroVersionResult.value,
        maestro_backend: backend,
      });
    },
  });
}

async function installMaestroRunnerWdaCache({
  logger,
  env,
}: {
  logger: bunyan;
  env: BuildStepEnv;
}): Promise<void> {
  const maestroRunnerHome =
    env.MAESTRO_RUNNER_HOME ?? (env.HOME ? path.join(env.HOME, '.maestro-runner') : undefined);
  if (!maestroRunnerHome) {
    logger.warn(
      'Skipping the prebuilt WebDriverAgent cache because the $HOME environment variable is empty.'
    );
    return;
  }

  try {
    const wdaVersion = await getMaestroRunnerWdaVersion({ maestroRunnerHome });
    if (!wdaVersion) {
      logger.info(
        'Skipping the prebuilt WebDriverAgent cache because the installed WDA version is unknown.'
      );
      return;
    }
    const xcodeVersion = await getXcodeVersion({ env });
    const iosRuntimeVersions = await getAvailableIosRuntimeVersions({ env });
    if (iosRuntimeVersions.length === 0) {
      logger.info(
        'Skipping the prebuilt WebDriverAgent cache because no iOS runtime is available.'
      );
      return;
    }

    const tempDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'install_maestro_runner_wda_cache')
    );
    try {
      const archiveName = `xcode-${xcodeVersion}-wda-${wdaVersion}.tar.gz`;
      const archivePath = path.join(tempDirectory, archiveName);
      const archiveUrl = `${MAESTRO_RUNNER_WDA_CACHE_URL}/${archiveName}`;

      logger.info(`Downloading the prebuilt WebDriverAgent cache for Xcode ${xcodeVersion}`);
      await spawn(
        'curl',
        ['--fail', '--location', '--silent', '--show-error', archiveUrl, '--output', archivePath],
        { logger, env }
      );
      await fs.promises.mkdir(maestroRunnerHome, { recursive: true });
      await spawn('tar', ['-xzf', archivePath, '-C', maestroRunnerHome], { logger, env });

      const genericProductsDirectory = path.join(
        maestroRunnerHome,
        'cache',
        'wda-builds',
        'generic',
        'DerivedData',
        'Build',
        'Products'
      );
      for (const runtimeVersion of iosRuntimeVersions) {
        const productsDirectory = path.join(
          maestroRunnerHome,
          'cache',
          'wda-builds',
          `sim-ios${runtimeVersion}-iphone`,
          'DerivedData',
          'Build',
          'Products'
        );
        await fs.promises.cp(genericProductsDirectory, productsDirectory, { recursive: true });
      }

      logger.info(
        `Installed the prebuilt WebDriverAgent cache for iOS ${iosRuntimeVersions.join(', ')}.`
      );
    } finally {
      await fs.promises.rm(tempDirectory, { force: true, recursive: true });
    }
  } catch (err: any) {
    logger.warn(
      { err },
      'Failed to install the prebuilt WebDriverAgent cache. maestro-runner will build WebDriverAgent when it is needed.'
    );
  }
}

async function getMaestroRunnerWdaVersion({
  maestroRunnerHome,
}: {
  maestroRunnerHome: string;
}): Promise<string | null> {
  try {
    const packageJson = JSON.parse(
      await fs.promises.readFile(
        path.join(maestroRunnerHome, 'drivers', 'ios', 'WebDriverAgent', 'package.json'),
        'utf8'
      )
    );
    return typeof packageJson.version === 'string' && packageJson.version.match(/^\d+\.\d+\.\d+$/)
      ? packageJson.version
      : null;
  } catch {
    return null;
  }
}

async function getXcodeVersion({ env }: { env: BuildStepEnv }): Promise<string> {
  const { stdout } = await spawn('xcodebuild', ['-version'], { stdio: 'pipe', env });
  const version = /^Xcode\s+(\d+(?:\.\d+)*)$/m.exec(stdout)?.[1];
  if (!version) {
    throw new Error(`Failed to parse Xcode version from: ${stdout.trim()}`);
  }
  return version;
}

async function getAvailableIosRuntimeVersions({ env }: { env: BuildStepEnv }): Promise<string[]> {
  const { stdout } = await spawn('xcrun', ['simctl', 'list', 'runtimes', '--json'], {
    stdio: 'pipe',
    env,
  });
  const runtimes = JSON.parse(stdout).runtimes as {
    identifier?: string;
    isAvailable?: boolean;
    version?: string;
  }[];

  return [
    ...new Set(
      runtimes
        .filter(
          runtime =>
            runtime.isAvailable !== false &&
            runtime.identifier?.startsWith('com.apple.CoreSimulator.SimRuntime.iOS-') &&
            runtime.version?.match(/^\d+(?:\.\d+)*$/)
        )
        .map(runtime => runtime.version as string)
    ),
  ];
}

async function getMaestroVersion({
  env,
  backend,
}: {
  env: BuildStepEnv;
  backend: MaestroBackend;
}): Promise<string> {
  switch (backend) {
    case 'maestro': {
      const { stdout } = await spawn('maestro', ['--version'], { stdio: 'pipe', env });
      // `maestro --version` can print an analytics notice to stdout before the version,
      // e.g. "Anonymous analytics enabled. To opt out, set MAESTRO_CLI_NO_ANALYTICS...\n2.0.10".
      // Take the last version-looking token: the real version is printed after the notice.
      const versions = stdout.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g);
      return versions?.at(-1) ?? stdout.trim();
    }
    case 'maestro-runner': {
      const { stdout } = await spawn('maestro-runner', ['--version'], { stdio: 'pipe', env });
      // maestro-runner prints build information after its version. The Go runtime version in
      // that output is also semver-shaped, so read only the prefixed runner version.
      return /^maestro-runner\s+(\S+)/m.exec(stdout)?.[1] ?? stdout.trim();
    }
  }
}

async function installMaestroRunner({
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
  logger.info('Fetching maestro-runner install script');
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'install_maestro_runner'));
  try {
    const installMaestroRunnerScriptResponse = await fetch(
      'https://open.devicelab.dev/install/maestro-runner'
    );
    const installMaestroRunnerScript = await installMaestroRunnerScriptResponse.text();
    const scriptPath = path.join(tempDirectory, 'install_maestro_runner.sh');
    await fs.promises.writeFile(scriptPath, installMaestroRunnerScript, { mode: 0o777 });
    logger.info('Installing maestro-runner');
    assert(
      env.HOME,
      'Failed to infer directory to install maestro-runner in: $HOME environment variable is empty.'
    );
    await spawn(scriptPath, version && version !== 'latest' ? ['--version', version] : [], {
      logger,
      env,
    });
    const binDir = path.join(env.HOME, '.maestro-runner', 'bin');
    global.updateEnv({
      ...global.env,
      PATH: `${global.env.PATH}:${binDir}`,
    });
    env.PATH = `${env.PATH}:${binDir}`;
    process.env.PATH = `${process.env.PATH}:${binDir}`;
  } finally {
    await fs.promises.rm(tempDirectory, { force: true, recursive: true });
  }
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
