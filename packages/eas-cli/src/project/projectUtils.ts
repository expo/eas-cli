import { ExpoConfig, getConfig, getConfigFilePaths, modifyConfigAsync } from '@expo/config';
import { AndroidConfig, IOSConfig } from '@expo/config-plugins';
import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';
import fs from 'fs-extra';
import gql from 'graphql-tag';
import path from 'path';
import pkgDir from 'pkg-dir';

import { graphqlClient, withErrorHandlingAsync } from '../graphql/client';
import { AppPrivacy, UpdateBranch } from '../graphql/generated';
import Log from '../log';
import { Actor } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { ensureProjectExistsAsync } from './ensureProjectExists';

export function getProjectAccountName(exp: ExpoConfig, user: Actor): string {
  switch (user.__typename) {
    case 'User':
      return exp.owner || user.username;
    case 'Robot':
      if (!exp.owner) {
        throw new Error(
          'The "owner" manifest property is required when using robot users. See: https://docs.expo.io/versions/latest/config/app/#owner'
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
          'The "owner" manifest property is required when using robot users. See: https://docs.expo.io/versions/latest/config/app/#owner'
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

export async function findProjectRootAsync(cwd?: string): Promise<string | null> {
  const projectRootDir = await pkgDir(cwd);
  return projectRootDir ?? null;
}

export async function setProjectIdAsync(projectDir: string): Promise<void> {
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });

  const privacy = toAppPrivacy(exp.privacy);
  const projectId = await ensureProjectExistsAsync({
    accountName: getProjectAccountName(exp, await ensureLoggedInAsync()),
    projectName: exp.slug,
    privacy,
  });

  const result = await modifyConfigAsync(projectDir, {
    extra: { ...exp.extra, eas: { ...exp.extra?.eas, projectId } },
  });

  if (result.type !== 'success') {
    throw new Error(result.message);
  }

  Log.withTick(`Linked app.json to project with ID ${chalk.bold(projectId)}`);
}

export async function getProjectIdAsync(exp: ExpoConfig): Promise<string> {
  const localProjectId = exp.extra?.eas?.projectId;
  if (localProjectId) {
    return localProjectId;
  }

  // Set the project ID if it is missing.
  const projectDir = await findProjectRootAsync(process.cwd());
  if (!projectDir) {
    throw new Error('Please run this command inside a project directory.');
  }
  await setProjectIdAsync(projectDir);
  const { exp: newExp } = getConfig(projectDir, { skipSDKVersionRequirement: true });

  const newLocalProjectId = newExp.extra?.eas?.projectId;
  if (!newLocalProjectId) {
    // throw if we still can't locate the projectId
    throw new Error('Could not retrieve project ID from app.json');
  }
  return newLocalProjectId;
}

const toAppPrivacy = (privacy: ExpoConfig['privacy']) => {
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

// TODO move to @expo/config
export async function getAndroidApplicationIdAsync(projectDir: string): Promise<string | null> {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradle(projectDir);
  if (!(await fs.pathExists(buildGradlePath))) {
    return null;
  }
  const buildGradle = await fs.readFile(buildGradlePath, 'utf8');
  const matchResult = buildGradle.match(/applicationId ['"](.*)['"]/);
  // TODO add fallback for legacy cases to read from AndroidManifest.xml
  return matchResult?.[1] ?? null;
}

export async function getAppIdentifierAsync({
  projectDir,
  platform,
  exp,
}: {
  projectDir: string;
  platform: Platform;
  exp: ExpoConfig;
}): Promise<string | null> {
  switch (platform) {
    case Platform.ANDROID: {
      const packageNameFromConfig = AndroidConfig.Package.getPackage(exp);
      if (packageNameFromConfig) {
        return packageNameFromConfig;
      }
      return (await fs.pathExists(path.join(projectDir, 'android')))
        ? await getAndroidApplicationIdAsync(projectDir)
        : null;
    }
    case Platform.IOS: {
      return (
        IOSConfig.BundleIdentifier.getBundleIdentifier(exp) ??
        IOSConfig.BundleIdentifier.getBundleIdentifierFromPbxproj(projectDir)
      );
    }
  }
}

export async function ensureAppIdentifierIsDefinedAsync({
  projectDir,
  platform,
  exp,
}: {
  projectDir: string;
  platform: Platform;
  exp: ExpoConfig;
}): Promise<string> {
  const appIdentifier = await getAppIdentifierAsync({ projectDir, platform, exp });
  if (!appIdentifier) {
    const desc = getProjectConfigDescription(projectDir);
    const fieldStr = platform === Platform.ANDROID ? 'android.package' : 'ios.bundleIdentifier';
    throw new Error(`Please define "${fieldStr}" in your ${desc}.`);
  }
  return appIdentifier;
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

export async function getBranchByNameAsync({
  appId,
  name,
}: {
  appId: string;
  name: string;
}): Promise<UpdateBranch> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<
        {
          app: {
            byId: {
              updateBranchByName: UpdateBranch;
            };
          };
        },
        {
          appId: string;
          name: string;
        }
      >(
        gql`
          query ViewBranch($appId: String!, $name: String!) {
            app {
              byId(appId: $appId) {
                id
                updateBranchByName(name: $name) {
                  id
                  name
                }
              }
            }
          }
        `,
        {
          appId,
          name,
        }
      )
      .toPromise()
  );
  return data.app.byId.updateBranchByName;
}
