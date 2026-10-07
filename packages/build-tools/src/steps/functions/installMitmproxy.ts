import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { BuildFunction, BuildRuntimePlatform, BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';

import { Sentry } from '../../sentry';

export function createInstallMitmproxyBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_mitmproxy',
    name: 'Install mitmproxy',
    __metricsId: 'eas/install_mitmproxy',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      // Some images ship the cask, and its quarantined first launch can hang.
      const canLaunch =
        env.EAS_BUILD_RUNNER !== 'eas-build' || (await removeMitmproxyQuarantineAsync(env));
      if (canLaunch && (await isMitmproxyAvailableAsync(env))) {
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
        if (!(await removeMitmproxyQuarantineAsync(env))) {
          throw new Error('Could not launch mitmproxy because it is still quarantined.');
        }
        if (!(await isMitmproxyAvailableAsync(env))) {
          throw new Error('`brew install --cask mitmproxy` succeeded but mitmdump did not run.');
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
  // Kills a first launch that Gatekeeper still holds, if the quarantine check missed it. Without
  // pipes, a child process that outlives mitmdump cannot hold the call open past the timeout.
  return (
    await asyncResult(
      spawn('mitmdump', ['--version'], {
        env,
        stdio: 'ignore',
        timeout: 60_000,
        killSignal: 'SIGKILL',
      })
    )
  ).ok;
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
 * quarantined first launch then never returns. Takes the app behind the `mitmdump` on PATH out of
 * quarantine, and returns false when it stays quarantined, so it is not launched.
 */
async function removeMitmproxyQuarantineAsync(env: BuildStepEnv): Promise<boolean> {
  const which = await asyncResult(spawn('which', ['mitmdump'], { env, stdio: 'pipe' }));
  const mitmdump = which.ok
    ? await fs.promises.realpath(which.value.stdout.trim()).catch(() => null)
    : null;
  if (!mitmdump) {
    return true;
  }
  const appEnd = mitmdump.lastIndexOf('.app/');
  const app = appEnd === -1 ? mitmdump : mitmdump.slice(0, appEnd + '.app'.length);
  await asyncResult(spawn('xattr', ['-dr', 'com.apple.quarantine', app], { env, stdio: 'pipe' }));
  const quarantined = await asyncResult(
    spawn('xattr', ['-p', 'com.apple.quarantine', mitmdump], { env, stdio: 'pipe' })
  );
  return !quarantined.ok;
}
