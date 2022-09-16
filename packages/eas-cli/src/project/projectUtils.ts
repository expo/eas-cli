import { ExpoConfig, getConfigFilePaths, getPackageJson, modifyConfigAsync } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import pkgDir from 'pkg-dir';
import resolveFrom from 'resolve-from';
import semver from 'semver';

import { AccountFragment, AppPrivacy } from '../graphql/generated';
import { AppQuery } from '../graphql/queries/AppQuery';
import Log from '../log';
import { ora } from '../ora';
import { Actor } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { expoCommandAsync } from '../utils/expoCli';
import { getVcsClient } from '../vcs';
import { getExpoConfig } from './expoConfig';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from './fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';

/**
 * @deprecated - prefer using the account that definitively owns the project by
 *               fetching it via the App.ownerAccount GraphQL field.
 */
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
async function saveProjectIdToAppConfigAsync(
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
      Log.warn();
      Log.warn(
        `Warning: Your project uses dynamic app configuration, and the EAS project ID can't automatically be added to it.`
      );
      Log.warn(
        chalk.dim(
          'https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs'
        )
      );
      Log.warn();
      Log.warn(
        `To complete the setup process, set the ${chalk.bold(
          'extra.eas.projectId'
        )} in your ${chalk.bold(getProjectConfigDescription(projectDir))}:`
      );
      Log.warn();
      Log.warn(chalk.bold(JSON.stringify({ expo: { extra: { eas: { projectId } } } }, null, 2)));
      Log.warn();
      throw new Error(result.message);
    }
    case 'fail':
      throw new Error(result.message);
    default:
      throw new Error('Unexpected result type from modifyConfigAsync');
  }
}

/**
 * Get the EAS project ID from the app config. If the project ID is not set in the config,
 * use the owner/slug to identify an EAS project on the server (asking for confirmation first),
 * and attempt to save the EAS project ID to the appropriate field in the app config. If unable to
 * save to the app config, throw an error.
 */
export async function getProjectIdAsync(
  exp: ExpoConfig,
  options: { env?: Env; nonInteractive: boolean },
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
    throw new Error('This command must be run inside a project directory.');
  }

  Log.warn('EAS project not configured.');

  const projectId = await fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync(
    {
      accountName: getProjectAccountName(
        exp,
        await ensureLoggedInAsync({ nonInteractive: options.nonInteractive })
      ),
      projectName: exp.slug,
      privacy: toAppPrivacy(exp.privacy),
    },
    {
      nonInteractive: options.nonInteractive,
    }
  );

  const spinner = ora(`Linking local project to EAS project ${projectId}`).start();
  try {
    await saveProjectIdToAppConfigAsync(projectDir, projectId, options);
    spinner.succeed(`Linked local project to EAS project ${projectId}`);
  } catch (e: any) {
    spinner.fail();
    throw e;
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

export async function getProjectFullNameAsync(
  exp: ExpoConfig,
  { nonInteractive }: { nonInteractive: boolean }
): Promise<string> {
  const user = await ensureLoggedInAsync({ nonInteractive });
  const accountName = getProjectAccountName(exp, user);
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

export async function getOwnerAccountForProjectIdAsync(
  projectId: string
): Promise<AccountFragment> {
  const app = await AppQuery.byIdAsync(projectId);
  return app.ownerAccount;
}
