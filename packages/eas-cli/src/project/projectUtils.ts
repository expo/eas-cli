import { ExpoConfig, getConfigFilePaths, getPackageJson, modifyConfigAsync } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import pkgDir from 'pkg-dir';
import resolveFrom from 'resolve-from';
import semver from 'semver';

import { AppPrivacy } from '../graphql/generated';
import Log from '../log';
import { confirmAsync } from '../prompts';
import { Actor } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { expoCommandAsync } from '../utils/expoCli';
import { getVcsClient } from '../vcs';
import {
  ensureProjectExistsAsync,
  findProjectIdByAccountNameAndSlugNullableAsync,
} from './ensureProjectExists';
import { getExpoConfig } from './expoConfig';

export function getProjectAccountName(exp: ExpoConfig, user: Actor): string {
  switch (user.__typename) {
    case 'User':
      return exp.owner || user.username;
    case 'Robot':
      if (!exp.owner) {
        throw new Error(
          'The "owner" manifest property is required when using robot users. See: https://docs.expo.dev/versions/latest/config/app/#owner'
        );
      }
      return exp.owner;
  }
}

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
  }
}

export async function getProjectAccountNameAsync(exp: ExpoConfig): Promise<string> {
  const user = await ensureLoggedInAsync();
  return getProjectAccountName(exp, user);
}

export async function findProjectRootAsync({
  cwd,
  defaultToProcessCwd = false,
}: {
  cwd?: string;
  defaultToProcessCwd?: boolean;
} = {}): Promise<string> {
  const projectRootDir = await pkgDir(cwd);
  if (!projectRootDir) {
    if (!defaultToProcessCwd) {
      throw new Error('Run this command inside a project directory.');
    } else {
      return process.cwd();
    }
  } else {
    let vcsRoot;
    try {
      vcsRoot = path.normalize(await getVcsClient().getRootPathAsync());
    } catch {}
    if (vcsRoot && vcsRoot.startsWith(projectRootDir) && vcsRoot !== projectRootDir) {
      throw new Error(
        `package.json is outside of the current git repository (project root: ${projectRootDir}, git root: ${vcsRoot}.`
      );
    }
    return projectRootDir;
  }
}

/**
 * Save an EAS project ID to the appropriate field in the app config.
 */
export async function saveProjectIdToAppConfigAsync(
  projectDir: string,
  projectId: string,
  options: { env?: Env } = {}
): Promise<void> {
  const exp = getExpoConfig(projectDir, options);
  const result = await modifyConfigAsync(projectDir, {
    extra: { ...exp.extra, eas: { ...exp.extra?.eas, projectId } },
  });

  switch (result.type) {
    case 'success':
      break;
    case 'warn': {
      Log.log();
      Log.warn('It looks like you are using a dynamic configuration!');
      Log.log(
        chalk.dim(
          'https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs)\n'
        )
      );
      Log.warn(
        'In order to finish setting up your project you are going to need manually add the following to your "extra" key:\n\n'
      );
      Log.log(chalk.bold(`"extra": {\n  ...\n  "eas": {\n    "projectId": "${projectId}"\n  }\n}`));
      throw new Error(result.message);
    }
    case 'fail':
      throw new Error(result.message);
    default:
      throw new Error('Unexpected result type from modifyConfigAsync');
  }
}

/**
 * Use the owner/slug to identify an EAS project on the server.
 *
 * @returns the EAS project ID from the server
 */
export async function fetchProjectIdFromServerAsync(exp: ExpoConfig): Promise<string> {
  const privacy = toAppPrivacy(exp.privacy);
  return await ensureProjectExistsAsync({
    accountName: getProjectAccountName(exp, await ensureLoggedInAsync()),
    projectName: exp.slug,
    privacy,
  });
}

/**
 * Get the EAS project ID from the app config. If the project ID is not set in the config.
 * use the owner/slug to identify an EAS project on the server, and attempt to save the
 * EAS project ID to the appropriate field in the app config.
 */
export async function getProjectIdAsync(
  exp: ExpoConfig,
  options: { env?: Env } = {},
  findProjectRootOptions: {
    cwd?: string;
    defaultToProcessCwd?: boolean;
  } = {}
): Promise<string> {
  const localProjectId = exp.extra?.eas?.projectId;
  if (localProjectId) {
    return localProjectId;
  }

  const projectDir = await findProjectRootAsync(findProjectRootOptions);
  if (!projectDir) {
    throw new Error('Run this command inside a project directory.');
  }

  const projectId = await fetchProjectIdFromServerAsync(exp);

  try {
    await saveProjectIdToAppConfigAsync(projectDir, projectId, options);
  } catch (e: any) {
    // saveProjectIdToAppConfigAsync already printed out a set of detailed errors and
    // instructions on how to fix it. To mimic throwing the error but not halting
    // execution, just warn here with the error message.
    Log.warn(e.message);
  }

  return projectId;
}

const toAppPrivacy = (privacy: ExpoConfig['privacy']): AppPrivacy => {
  if (privacy === 'public') {
    return AppPrivacy.Public;
  } else if (privacy === 'hidden') {
    return AppPrivacy.Hidden;
  } else {
    return AppPrivacy.Unlisted;
  }
};

export async function getProjectFullNameAsync(exp: ExpoConfig): Promise<string> {
  const accountName = await getProjectAccountNameAsync(exp);
  return `@${accountName}/${exp.slug}`;
}

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

// return project id of existing/newly created project, or null if user declines
export async function promptToCreateProjectIfNotExistsAsync(
  exp: ExpoConfig
): Promise<string | null> {
  const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());
  const maybeProjectId = await findProjectIdByAccountNameAndSlugNullableAsync(
    accountName,
    exp.slug
  );
  if (maybeProjectId) {
    return maybeProjectId;
  }
  const fullName = await getProjectFullNameAsync(exp);
  const shouldCreateProject = await confirmAsync({
    message: `Looks like ${fullName} is new. Register it with EAS?`,
  });
  if (!shouldCreateProject) {
    return null;
  }
  const privacy = toAppPrivacy(exp.privacy);
  return await ensureProjectExistsAsync({
    accountName,
    projectName: exp.slug,
    privacy,
  });
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

export async function installExpoUpdatesAsync(projectDir: string): Promise<void> {
  Log.newLine();
  Log.log(`Running ${chalk.bold('expo install expo-updates')}`);
  Log.newLine();
  await expoCommandAsync(projectDir, ['install', 'expo-updates']);
  Log.newLine();
}
