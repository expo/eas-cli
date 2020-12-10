import { getConfig, getConfigFilePaths } from '@expo/config';
import { AndroidConfig, IOSConfig } from '@expo/config-plugins';
import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import gql from 'graphql-tag';
import path from 'path';
import pkgDir from 'pkg-dir';

import { graphqlClient, withErrorHandlingAsync } from '../graphql/client';
import { UpdateRelease } from '../graphql/generated';
import { ensureLoggedInAsync } from '../user/actions';
import { ensureProjectExistsAsync } from './ensureProjectExists';

export async function getProjectAccountNameAsync(projectDir: string): Promise<string> {
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  const user = await ensureLoggedInAsync();
  return exp.owner || user.username;
}

export async function findProjectRootAsync(cwd?: string): Promise<string | null> {
  const projectRootDir = await pkgDir(cwd);
  return projectRootDir ?? null;
}

export async function getProjectIdAsync(projectDir: string): Promise<string> {
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  return await ensureProjectExistsAsync({
    accountName: await getProjectAccountNameAsync(projectDir),
    projectName: exp.slug,
    privacy: exp.privacy,
  });
}

export async function getProjectFullNameAsync(projectDir: string): Promise<string> {
  const accountName = await getProjectAccountNameAsync(projectDir);
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });

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

export async function getAppIdentifierAsync(
  projectDir: string,
  platform: Platform
): Promise<string | null> {
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  switch (platform) {
    case Platform.Android: {
      const packageNameFromConfig = AndroidConfig.Package.getPackage(exp);
      if (packageNameFromConfig) {
        return packageNameFromConfig;
      }
      return (await fs.pathExists(path.join(projectDir, 'android')))
        ? await getAndroidApplicationIdAsync(projectDir)
        : null;
    }
    case Platform.iOS: {
      return (
        IOSConfig.BundleIdenitifer.getBundleIdentifier(exp) ??
        IOSConfig.BundleIdenitifer.getBundleIdentifierFromPbxproj(projectDir)
      );
    }
  }
}

export async function ensureAppIdentifierIsDefinedAsync(
  projectDir: string,
  platform: Platform
): Promise<string> {
  const appIdentifier = await getAppIdentifierAsync(projectDir, platform);
  if (!appIdentifier) {
    const desc = getProjectConfigDescription(projectDir);
    const fieldStr = Platform.Android ? 'android.package' : 'ios.bundleIdentifier';
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

export async function getReleaseByNameAsync({
  appId,
  releaseName,
}: {
  appId: string;
  releaseName: string;
}): Promise<UpdateRelease> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<
        {
          app: {
            byId: {
              updateReleaseByReleaseName: UpdateRelease;
            };
          };
        },
        {
          appId: string;
          releaseName: string;
        }
      >(
        gql`
          query ViewRelease($appId: String!, $releaseName: String!) {
            app {
              byId(appId: $appId) {
                updateReleaseByReleaseName(releaseName: $releaseName) {
                  id
                  releaseName
                }
              }
            }
          }
        `,
        {
          appId,
          releaseName,
        }
      )
      .toPromise()
  );
  return data.app.byId.updateReleaseByReleaseName;
}
