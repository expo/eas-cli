import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { BuildFunction, BuildRuntimePlatform, BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { Sentry } from '../../sentry';

export function createInstallMitmproxyBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_mitmproxy',
    name: 'Install mitmproxy',
    __metricsId: 'eas/install_mitmproxy',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      if (env.EAS_BUILD_RUNNER === 'eas-build') {
        // Some images ship the cask, and its quarantined first launch can hang.
        await removeMitmproxyQuarantineAsync(env);
      }

      if (await isMitmproxyAvailableAsync(env)) {
        logger.info('mitmproxy is already installed.');
        return;
      }

      if (env.EAS_BUILD_RUNNER !== 'eas-build') {
        logger.warn(
          'mitmproxy is not installed and network capture needs it. Install it with `brew install --cask mitmproxy` and rerun the job.'
        );
        return;
      }

      try {
        logger.info('Installing mitmproxy with Homebrew.');
        await installMitmproxyWithHomebrewAsync({ env, logger });
        await removeMitmproxyQuarantineAsync(env);

        if (!(await isMitmproxyAvailableAsync(env))) {
          throw new Error('`brew install --cask mitmproxy` succeeded but mitmdump is not on PATH.');
        }
        logger.info('Installed mitmproxy.');
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Could not install mitmproxy for the device session', error, {
          level: 'warning',
        });
        logger.warn(
          { err: error },
          'Could not install mitmproxy, so network capture will record nothing in this session. Re-run the session to retry the install, or run it without network capture.'
        );
      }
    },
  });
}

async function isMitmproxyAvailableAsync(env: BuildStepEnv): Promise<boolean> {
  return (await asyncResult(spawn('mitmdump', ['--version'], { env }))).ok;
}

async function installMitmproxyWithHomebrewAsync({
  env,
  logger,
}: {
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  await spawn('brew', ['install', '--cask', 'mitmproxy'], {
    env: { ...env, HOMEBREW_NO_AUTO_UPDATE: '1' },
    logger,
  });
}

/**
 * Gatekeeper has rejected the mitmproxy 12.2.3 cask as unnotarized since 2026-10-06, and a
 * quarantined first launch then never returns, so take the cask out of quarantine.
 */
async function removeMitmproxyQuarantineAsync(env: BuildStepEnv): Promise<void> {
  const caskroom =
    process.arch === 'arm64' ? '/opt/homebrew/Caskroom/mitmproxy' : '/usr/local/Caskroom/mitmproxy';
  await asyncResult(spawn('xattr', ['-dr', 'com.apple.quarantine', caskroom], { env }));
}
