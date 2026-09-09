import downloadFile from '@expo/downloader';
import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepEnv,
  BuildStepGlobalContext,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MITMPROXY_VERSION = '12.2.3';
const MITMPROXY_DOWNLOAD_URL = `https://storage.googleapis.com/turtle-v2/mitmproxy-${MITMPROXY_VERSION}-macos-arm64.tar.gz`;
const MITMPROXY_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export function createInstallMitmproxyBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_mitmproxy',
    name: 'Install mitmproxy',
    __metricsId: 'eas/install_mitmproxy',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger, global }, { env }) => {
      if (await isMitmproxyAvailableAsync(env)) {
        logger.info('mitmproxy is already installed.');
        return;
      }

      if (env.EAS_BUILD_RUNNER !== 'eas-build') {
        logger.warn(
          'mitmproxy is not installed and network capture needs it. Install it with `brew install mitmproxy` and rerun the job.'
        );
        return;
      }

      await installMitmproxyFromGcsAsync({ logger, env, global });

      if (!(await isMitmproxyAvailableAsync(env))) {
        throw new SystemError(
          `Installed mitmproxy ${MITMPROXY_VERSION} but mitmdump is still not runnable. The artifact may not match the worker image architecture.`
        );
      }

      logger.info(`Installed mitmproxy ${MITMPROXY_VERSION}.`);
    },
  });
}

async function isMitmproxyAvailableAsync(env: BuildStepEnv): Promise<boolean> {
  return (await asyncResult(spawn('mitmdump', ['--version'], { env }))).ok;
}

async function installMitmproxyFromGcsAsync({
  logger,
  env,
  global,
}: {
  logger: bunyan;
  env: BuildStepEnv;
  global: BuildStepGlobalContext;
}): Promise<void> {
  assert(
    env.HOME,
    'Failed to infer directory to install mitmproxy in: $HOME environment variable is empty.'
  );
  const installDirectory = path.join(env.HOME, '.eas-mitmproxy');
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'install_mitmproxy'));
  const archivePath = path.join(tempDirectory, 'mitmproxy.tar.gz');

  try {
    logger.info(`Downloading mitmproxy ${MITMPROXY_VERSION}`);
    try {
      await downloadFile(MITMPROXY_DOWNLOAD_URL, archivePath, {
        retry: 3,
        timeout: MITMPROXY_DOWNLOAD_TIMEOUT_MS,
      });
    } catch (err) {
      throw new SystemError(
        `Could not download mitmproxy ${MITMPROXY_VERSION} from ${MITMPROXY_DOWNLOAD_URL}. Check that the artifact exists in the turtle-v2 bucket.`,
        { cause: err }
      );
    }

    await fs.promises.rm(installDirectory, { force: true, recursive: true });
    await fs.promises.mkdir(installDirectory, { recursive: true });
    logger.info('Extracting mitmproxy');
    await spawn('tar', ['-xzf', archivePath, '-C', installDirectory], { logger, env });
  } finally {
    await fs.promises.rm(tempDirectory, { force: true, recursive: true });
  }

  const mitmproxyBinDir = path.join(installDirectory, 'mitmproxy.app', 'Contents', 'MacOS');
  global.updateEnv({
    ...global.env,
    PATH: `${mitmproxyBinDir}:${global.env.PATH}`,
  });
  env.PATH = `${mitmproxyBinDir}:${env.PATH}`;
  process.env.PATH = `${mitmproxyBinDir}:${process.env.PATH}`;
}
