import { ExpoConfig, getConfigFilePaths, getPackageJson } from '@expo/config';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import resolveFrom from 'resolve-from';
import semver from 'semver';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountFragment, AppPrivacy } from '../graphql/generated';
import { AppQuery } from '../graphql/queries/AppQuery';
import Log from '../log';
import { Actor } from '../user/User';
import { expoCommandAsync } from '../utils/expoCli';

export function getUsername(exp: ExpoConfig, user: Actor): string | undefined {
  switch (user.__typename) {
    case 'User':
      return user.username;
    case 'Robot':
      // owner field is necessary to run `expo prebuild`
      if (!exp.owner) {
        throw new Error(
          'The "owner" manifest property is required when using robot users. See: https://docs.expo.dev/versions/latest/config/app/#owner'
        );
      }
      // robot users don't have usernames
      return undefined;
    case 'SSOUser':
      throw new Error('SSO users are not supported yet.');
  }
}

export const toAppPrivacy = (privacy: ExpoConfig['privacy']): AppPrivacy => {
  if (privacy === 'public') {
    return AppPrivacy.Public;
  } else if (privacy === 'hidden') {
    return AppPrivacy.Hidden;
  } else {
    return AppPrivacy.Unlisted;
  }
};

/**
 * Return a useful name describing the project config.
 * - dynamic: app.config.js
 * - static: app.json
 * - custom path app config relative to root folder
 * - both: app.config.js or app.json
 */
export function getProjectConfigDescription(projectDir: string): string {
  const paths = getConfigFilePaths(projectDir);
  if (paths.dynamicConfigPath) {
    const relativeDynamicConfigPath = path.relative(projectDir, paths.dynamicConfigPath);
    if (paths.staticConfigPath) {
      return `${relativeDynamicConfigPath} or ${path.relative(projectDir, paths.staticConfigPath)}`;
    }
    return relativeDynamicConfigPath;
  } else if (paths.staticConfigPath) {
    return path.relative(projectDir, paths.staticConfigPath);
  }
  return 'app.config.js/app.json';
}

export function isExpoUpdatesInstalled(projectDir: string): boolean {
  const packageJson = getPackageJson(projectDir);
  return !!(packageJson.dependencies && 'expo-updates' in packageJson.dependencies);
}

export function isExpoUpdatesInstalledOrAvailable(
  projectDir: string,
  sdkVersion?: string
): boolean {
  // before sdk 44, expo-updates was included in with the expo module
  if (sdkVersion && semver.lt(sdkVersion, '44.0.0')) {
    return true;
  }

  return isExpoUpdatesInstalled(projectDir);
}

export async function validateAppVersionRuntimePolicySupportAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  if (typeof exp.runtimeVersion !== 'object' || exp.runtimeVersion?.policy !== 'appVersion') {
    return;
  }

  const maybePackageJson = resolveFrom.silent(projectDir, 'expo-updates/package.json');
  if (maybePackageJson) {
    const { version } = await fs.readJson(maybePackageJson);
    if (semver.gte(version, '0.14.4')) {
      return;
    }
  }

  Log.warn(
    `You need to be on SDK 46 or higher, and use expo-updates >= 0.14.4 to use appVersion runtime policy.`
  );
}

export async function installExpoUpdatesAsync(
  projectDir: string,
  options?: { silent: boolean }
): Promise<void> {
  Log.log(chalk.gray`> npx expo install expo-updates`);
  try {
    await expoCommandAsync(projectDir, ['install', 'expo-updates'], { silent: options?.silent });
  } catch (error: any) {
    if (options?.silent) {
      Log.error('stdout' in error ? error.stdout : error.message);
    }
    throw error;
  }
}

export async function getOwnerAccountForProjectIdAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string
): Promise<AccountFragment> {
  const app = await AppQuery.byIdAsync(graphqlClient, projectId);
  return app.ownerAccount;
}

export async function getDisplayNameForProjectIdAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string
): Promise<string> {
  const app = await AppQuery.byIdAsync(graphqlClient, projectId);
  return app.fullName;
}
