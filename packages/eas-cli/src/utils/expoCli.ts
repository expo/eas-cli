import { ExpoConfig } from '@expo/config-types';
import { createForProject } from '@expo/package-manager';
import chalk from 'chalk';
import { boolish } from 'getenv';
import resolveFrom from 'resolve-from';
import semver from 'semver';

import Log from '../log';
import { memoize } from './expodash/memoize';

// Aggressively returns `true` (UNVERSIONED, invalid SDK version format) to push users towards the versioned CLI.
function gteSdkVersion(fromSdkVersion: string, sdkVersion: string): boolean {
  if (fromSdkVersion === 'UNVERSIONED') {
    return true;
  }

  try {
    return semver.gte(fromSdkVersion, sdkVersion);
  } catch {
    return true;
  }
}

/**
 * @returns `true` if the project is SDK +46, has `@expo/cli`, and `EXPO_USE_LOCAL_CLI` is not set to a _false_ value.
 */
export function shouldUseVersionedExpoCLIExpensive(
  projectDir: string,
  exp: Pick<ExpoConfig, 'sdkVersion'>
): boolean {
  // Users can disable local CLI settings EXPO_USE_LOCAL_CLI=false
  // https://github.com/expo/expo/blob/69eddda7bb1dbfab44258f468cf7f22984c1e44e/packages/expo/bin/cli.js#L10
  // Run the environment variable check first as it's the cheapest.
  const userDefinedVersionedCliEnabled = boolish('EXPO_USE_LOCAL_CLI', true);
  if (!userDefinedVersionedCliEnabled) {
    return false;
  }

  try {
    // NOTE(EvanBacon): The CLI package could be available through a monorepo
    // we need to ensure the project is specifically using a known supported Expo SDK version.

    if (
      // If the version isn't defined then skip the check.
      // Users running in a non-standard way should use the latest supported behavior (local CLI).
      exp.sdkVersion &&
      !gteSdkVersion(exp.sdkVersion, '46.0.0')
    ) {
      return false;
    }
  } catch (error) {
    Log.debug('Error detecting Expo SDK version for enabling versioned Expo CLI:', error);
  }

  // Finally ensure the CLI is available for sanity.
  return !!resolveFrom.silent(projectDir, 'expo');
}

/**
 * Determine if we can and should use `expo export` with multiple `--platform` flags.
 * This is an issue related to `expo export --all` causing issues when users have Metro web configured.
 * See: https://github.com/expo/expo/pull/23621
 */
export function shouldUseVersionedExpoCLIWithExplicitPlatformsExpensive(
  projectDir: string
): boolean {
  const expoPath = resolveFrom.silent(projectDir, 'expo');
  const expoCliPath = expoPath && resolveFrom.silent(expoPath, '@expo/cli/package.json');
  if (!expoCliPath) {
    return false;
  }

  return gteSdkVersion(require(expoCliPath).version, '0.10.11');
}

export const shouldUseVersionedExpoCLI = memoize(shouldUseVersionedExpoCLIExpensive);
export const shouldUseVersionedExpoCLIWithExplicitPlatforms = memoize(
  shouldUseVersionedExpoCLIWithExplicitPlatformsExpensive
);

export async function expoCommandAsync(
  projectDir: string,
  args: string[],
  { silent = false }: { silent?: boolean } = {}
): Promise<void> {
  const packageManager = createForProject(projectDir, {
    silent,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  const commandPromise = packageManager.runAsync(['expo', ...args]);
  const { child: spawnPromise } = commandPromise;

  if (!spawnPromise.stdout || !spawnPromise.stderr) {
    throw new Error('Failed to spawn expo-cli');
  }

  if (!silent) {
    spawnPromise.stdout.on('data', data => {
      for (const line of data.toString().trim().split('\n')) {
        Log.log(`${chalk.gray('[expo-cli]')} ${line}`);
      }
    });

    spawnPromise.stderr.on('data', data => {
      for (const line of data.toString().trim().split('\n')) {
        Log.warn(`${chalk.gray('[expo-cli]')} ${line}`);
      }
    });
  }

  await commandPromise;
}
