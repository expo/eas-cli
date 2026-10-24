import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import { NpmCacheRegistryInstallError, isNpmCacheInstallFailure } from './npmCacheRegistry';
import { Sentry } from '../sentry';

export async function installIsolatedNpmPackageAsync({
  packageSpec,
  directory,
  npmCacheUrl,
  pathEnv,
  logger,
  signal,
}: {
  packageSpec: string;
  directory: string;
  npmCacheUrl: string | undefined;
  pathEnv: string | undefined;
  logger?: bunyan;
  signal?: AbortSignal;
}): Promise<void> {
  const installAsync = async (registryUrl: string | undefined): Promise<void> => {
    await spawn(
      'npm',
      [
        'install',
        '--prefix',
        directory,
        '--no-save',
        '--package-lock=false',
        '--no-audit',
        '--no-fund',
        '--no-update-notifier',
        ...(registryUrl ? ['--registry', registryUrl] : []),
        packageSpec,
      ],
      // npm reads the user config in $HOME from any cwd, so the install directory doubles as HOME.
      { env: { PATH: pathEnv, HOME: directory }, logger, signal }
    );
  };

  if (!npmCacheUrl) {
    await installAsync(undefined);
    return;
  }
  try {
    await installAsync(npmCacheUrl);
  } catch (error) {
    signal?.throwIfAborted();
    if (!isNpmCacheInstallFailure(error, npmCacheUrl)) {
      throw error;
    }
    logger?.warn(
      `Failed to install ${packageSpec} using the npm cache registry (${npmCacheUrl}). Retrying without the npm cache registry.`
    );
    Sentry.capture(new NpmCacheRegistryInstallError(error), {
      level: 'warning',
      extras: { packageSpec, npmCacheUrl },
    });
    await installAsync(undefined);
  }
}
