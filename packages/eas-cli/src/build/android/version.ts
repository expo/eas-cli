import { ExpoConfig } from '@expo/config';
import { AndroidConfig, Updates } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../../graphql/generated';
import { AppVersionMutation } from '../../graphql/mutations/AppVersionMutation';
import { AppVersionQuery } from '../../graphql/queries/AppVersionQuery';
import Log from '../../log';
import { ora } from '../../ora';
import {
  getAppBuildGradleAsync,
  parseGradleCommand,
  resolveConfigValue,
} from '../../project/android/gradleUtils';
import { getNextVersionCode } from '../../project/android/versions';
import { resolveWorkflowAsync } from '../../project/workflow';
import { Client } from '../../vcs/vcs';
import { updateAppJsonConfigAsync } from '../utils/appJson';
import { bumpAppVersionAsync, ensureStaticConfigExists } from '../utils/version';

export enum BumpStrategy {
  APP_VERSION,
  VERSION_CODE,
  NOOP,
}

export async function bumpVersionAsync({
  bumpStrategy,
  projectDir,
  exp,
}: {
  projectDir: string;
  exp: ExpoConfig;
  bumpStrategy: BumpStrategy;
}): Promise<void> {
  if (bumpStrategy === BumpStrategy.NOOP) {
    return;
  }
  ensureStaticConfigExists(projectDir);

  const buildGradle = await getAppBuildGradleAsync(projectDir);
  const isMultiFlavor =
    buildGradle.android?.productFlavors ?? buildGradle.android?.flavorDimensions;
  if (isMultiFlavor) {
    throw new Error(
      'Automatic version bumping is not supported for multi-flavor Android projects.'
    );
  }

  await bumpVersionInAppJsonAsync({ bumpStrategy, projectDir, exp });
  Log.log('Updated versions in app.json');
  await updateNativeVersionsAsync({
    projectDir,
    version: exp.version,
    versionCode: exp.android?.versionCode,
  });
  Log.log('Synchronized versions with build gradle');
}

export async function bumpVersionInAppJsonAsync({
  bumpStrategy,
  projectDir,
  exp,
}: {
  bumpStrategy: BumpStrategy;
  projectDir: string;
  exp: ExpoConfig;
}): Promise<void> {
  if (bumpStrategy === BumpStrategy.NOOP) {
    return;
  }

  ensureStaticConfigExists(projectDir);
  Log.addNewLineIfNone();

  if (bumpStrategy === BumpStrategy.APP_VERSION) {
    const appVersion = AndroidConfig.Version.getVersionName(exp) ?? '1.0.0';
    await bumpAppVersionAsync({ appVersion, projectDir, exp });
  } else {
    const versionCode = AndroidConfig.Version.getVersionCode(exp);
    const bumpedVersionCode = getNextVersionCode(versionCode);
    Log.log(
      `Bumping ${chalk.bold('expo.android.versionCode')} from ${chalk.bold(
        versionCode
      )} to ${chalk.bold(bumpedVersionCode)}`
    );
    await updateAppJsonConfigAsync({ projectDir, exp }, config => {
      config.android = { ...config.android, versionCode: bumpedVersionCode };
    });
  }
}

export async function maybeResolveVersionsAsync(
  projectDir: string,
  exp: ExpoConfig,
  buildProfile: BuildProfile<Platform.ANDROID>,
  vcsClient: Client
): Promise<{ appVersion?: string; appBuildVersion?: string; isVersionInitialized?: boolean }> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient);
  if (workflow === Workflow.GENERIC) {
    const buildGradle = await getAppBuildGradleAsync(projectDir);
    try {
      const parsedGradleCommand = buildProfile.gradleCommand
        ? parseGradleCommand(buildProfile.gradleCommand, buildGradle)
        : undefined;

      return {
        appVersion:
          resolveConfigValue(buildGradle, 'versionName', parsedGradleCommand?.flavor) ?? '1.0.0',
        appBuildVersion:
          resolveConfigValue(buildGradle, 'versionCode', parsedGradleCommand?.flavor) ?? '1',
        isVersionInitialized: !resolveConfigValue(
          buildGradle,
          'versionCode',
          parsedGradleCommand?.flavor
        ),
      };
    } catch {
      return {};
    }
  } else {
    return {
      appBuildVersion: String(AndroidConfig.Version.getVersionCode(exp)),
      appVersion: exp.version,
    };
  }
}

export async function updateNativeVersionsAsync({
  projectDir,
  version,
  versionCode,
}: {
  projectDir: string;
  version?: string;
  versionCode?: number;
}): Promise<void> {
  const buildGradle = await readBuildGradleAsync(projectDir);
  if (!buildGradle) {
    throw new Error('This project is missing a build.gradle file.');
  }
  let updatedBuildGradle = buildGradle;
  if (version !== undefined) {
    updatedBuildGradle = updatedBuildGradle.replace(
      new RegExp(`versionName ".*"`),
      `versionName "${version}"`
    );
  }
  if (versionCode !== undefined) {
    updatedBuildGradle = updatedBuildGradle.replace(
      new RegExp(`versionCode.*`),
      `versionCode ${versionCode}`
    );
  }
  await writeBuildGradleAsync({ projectDir, buildGradle: updatedBuildGradle });
}

async function readBuildGradleAsync(projectDir: string): Promise<string | undefined> {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectDir);
  if (!(await fs.pathExists(buildGradlePath))) {
    return undefined;
  }
  return await fs.readFile(buildGradlePath, 'utf8');
}

async function writeBuildGradleAsync({
  projectDir,
  buildGradle,
}: {
  projectDir: string;
  buildGradle: string;
}): Promise<void> {
  const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectDir);
  await fs.writeFile(buildGradlePath, buildGradle);
}

/**
 * Returns buildNumber that will be used for the next build. If current build profile
 * has an 'autoIncrement' option set, it increments the version on server.
 */
export async function resolveRemoteVersionCodeAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectDir,
    projectId,
    exp,
    applicationId,
    buildProfile,
    vcsClient,
  }: {
    projectDir: string;
    projectId: string;
    exp: ExpoConfig;
    applicationId: string;
    buildProfile: BuildProfile<Platform.ANDROID>;
    vcsClient: Client;
  }
): Promise<string> {
  const remoteVersions = await AppVersionQuery.latestVersionAsync(
    graphqlClient,
    projectId,
    AppPlatform.Android,
    applicationId
  );

  const localVersions = await maybeResolveVersionsAsync(projectDir, exp, buildProfile, vcsClient);
  let currentBuildVersion: string;
  let shouldInitializeVersionCode = false;
  if (remoteVersions?.buildVersion) {
    currentBuildVersion = remoteVersions.buildVersion;
  } else {
    if (localVersions.appBuildVersion) {
      Log.log(
        chalk.green(
          'No remote versions are configured for this project, versionCode will be initialized based on the value from the local project.'
        )
      );
      currentBuildVersion = localVersions.appBuildVersion;
      shouldInitializeVersionCode = localVersions.isVersionInitialized ?? false;
    } else {
      Log.error(
        `Remote versions are not configured and EAS CLI was not able to read the current version from your project. Use "eas build:version:set" to initialize remote versions.`
      );
      throw new Error('Remote versions are not configured.');
    }
  }
  if (!buildProfile.autoIncrement && remoteVersions?.buildVersion) {
    return currentBuildVersion;
  } else if (
    (!buildProfile.autoIncrement && !remoteVersions?.buildVersion) ||
    shouldInitializeVersionCode
  ) {
    const spinner = ora(
      `Initializing versionCode with ${chalk.bold(currentBuildVersion)}.`
    ).start();
    try {
      await AppVersionMutation.createAppVersionAsync(graphqlClient, {
        appId: projectId,
        platform: AppPlatform.Android,
        applicationIdentifier: applicationId,
        storeVersion: localVersions.appVersion ?? exp.version ?? '1.0.0',
        buildVersion: currentBuildVersion,
        runtimeVersion:
          (await Updates.getRuntimeVersionNullableAsync(projectDir, exp, Platform.ANDROID)) ??
          undefined,
      });
      spinner.succeed(`Initialized versionCode with ${chalk.bold(currentBuildVersion)}.`);
    } catch (err) {
      spinner.fail(`Failed to initialize versionCode with ${chalk.bold(currentBuildVersion)}.`);
      throw err;
    }
    return currentBuildVersion;
  } else {
    const nextBuildVersion = getNextVersionCode(currentBuildVersion);
    const spinner = ora(
      `Incrementing versionCode from ${chalk.bold(currentBuildVersion)} to ${chalk.bold(
        nextBuildVersion
      )}.`
    ).start();
    try {
      await AppVersionMutation.createAppVersionAsync(graphqlClient, {
        appId: projectId,
        platform: AppPlatform.Android,
        applicationIdentifier: applicationId,
        storeVersion: localVersions.appVersion ?? exp.version ?? '1.0.0',
        buildVersion: String(nextBuildVersion),
        runtimeVersion:
          (await Updates.getRuntimeVersionNullableAsync(projectDir, exp, Platform.ANDROID)) ??
          undefined,
      });
      spinner.succeed(
        `Incremented versionCode from ${chalk.bold(currentBuildVersion)} to ${chalk.bold(
          nextBuildVersion
        )}.`
      );
    } catch (err) {
      spinner.fail(
        `Failed to increment versionCode from ${chalk.bold(currentBuildVersion)} to ${chalk.bold(
          nextBuildVersion
        )}.`
      );
      throw err;
    }
    return String(nextBuildVersion);
  }
}
