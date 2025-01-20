import { ExpoConfig } from '@expo/config';
import { IOSConfig, Updates } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import chalk from 'chalk';
import path from 'path';
import type { XCBuildConfiguration } from 'xcode';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { Target } from '../../credentials/ios/types';
import { AppPlatform } from '../../graphql/generated';
import { AppVersionMutation } from '../../graphql/mutations/AppVersionMutation';
import { AppVersionQuery } from '../../graphql/queries/AppVersionQuery';
import Log, { learnMore } from '../../log';
import { ora } from '../../ora';
import { findApplicationTarget } from '../../project/ios/target';
import { getNextBuildNumber, isValidBuildNumber } from '../../project/ios/versions';
import { resolveWorkflowAsync } from '../../project/workflow';
import { promptAsync } from '../../prompts';
import uniqBy from '../../utils/expodash/uniqBy';
import { readPlistAsync, writePlistAsync } from '../../utils/plist';
import { Client } from '../../vcs/vcs';
import { updateAppJsonConfigAsync } from '../utils/appJson';
import { bumpAppVersionAsync, ensureStaticConfigExists } from '../utils/version';

const SHORT_VERSION_REGEX = /^\d+(\.\d+){0,2}$/;

export enum BumpStrategy {
  APP_VERSION,
  BUILD_NUMBER,
  NOOP,
}

export async function bumpVersionAsync({
  bumpStrategy,
  projectDir,
  exp,
  targets,
}: {
  projectDir: string;
  exp: ExpoConfig;
  bumpStrategy: BumpStrategy;
  targets: Target[];
}): Promise<void> {
  if (bumpStrategy === BumpStrategy.NOOP) {
    return;
  }
  ensureStaticConfigExists(projectDir);
  await bumpVersionInAppJsonAsync({ bumpStrategy, projectDir, exp });
  Log.log('Updated versions in app.json');
  await updateNativeVersionsAsync({
    projectDir,
    version: exp.version,
    buildNumber: exp.ios?.buildNumber,
    targets,
  });
  Log.log('Synchronized versions with Info.plist');
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
    const appVersion = IOSConfig.Version.getVersion(exp);
    await bumpAppVersionAsync({ appVersion, projectDir, exp });
  } else {
    const buildNumber = IOSConfig.Version.getBuildNumber(exp);
    if (isValidBuildNumber(buildNumber)) {
      const bumpedBuildNumber = getNextBuildNumber(buildNumber);
      Log.log(
        `Bumping ${chalk.bold('expo.ios.buildNumber')} from ${chalk.bold(
          buildNumber
        )} to ${chalk.bold(bumpedBuildNumber)}`
      );
      await updateAppJsonConfigAsync({ projectDir, exp }, config => {
        config.ios = { ...config.ios, buildNumber: String(bumpedBuildNumber) };
      });
    } else {
      Log.log(`${chalk.bold('expo.ios.buildNumber')} = ${chalk.bold(buildNumber)} is not a number`);
      const { bumpedBuildNumber } = await promptAsync({
        type: 'text',
        name: 'bumpedBuildNumber',
        message: 'What is the next build number?',
      });
      await updateAppJsonConfigAsync({ projectDir, exp }, config => {
        config.ios = { ...config.ios, buildNumber: String(bumpedBuildNumber) };
      });
    }
  }
}

function validateShortVersion({
  shortVersion,
  workflow,
}: {
  shortVersion: string | undefined;
  workflow: Workflow;
}): void {
  if (shortVersion && !SHORT_VERSION_REGEX.test(shortVersion)) {
    if (workflow === Workflow.MANAGED) {
      Log.warn(
        `The required format for "version" field from app.json/app.config.ts for App Store iOS builds is one to three period-separated integers, such as 10.14.1. The string can only contain numeric characters (0-9) and periods. Current value: ${shortVersion}. Edit the "version" field in your app.json/app.config.ts to match the format required by Apple. ${learnMore(
          'https://developer.apple.com/documentation/bundleresources/information_property_list/cfbundleshortversionstring'
        )}`
      );
    } else {
      Log.warn(
        `The required format for "CFBundleShortVersionString" in Info.plist for App Store iOS builds is one to three period-separated integers, such as 10.14.1. The string can only contain numeric characters (0-9) and periods. Current value: ${shortVersion}. Edit the "CFBundleShortVersionString" in your Info.plist to match the format required by Apple. ${learnMore(
          'https://developer.apple.com/documentation/bundleresources/information_property_list/cfbundleshortversionstring'
        )}`
      );
    }
  }
}

export async function readShortVersionAsync(
  projectDir: string,
  exp: ExpoConfig,
  buildSettings: XCBuildConfiguration['buildSettings'],
  vcsClient: Client
): Promise<string | undefined> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient);
  if (workflow === Workflow.GENERIC) {
    const infoPlist = await readInfoPlistAsync(projectDir, buildSettings);

    const shortVersion =
      infoPlist.CFBundleShortVersionString &&
      evaluateTemplateString(infoPlist.CFBundleShortVersionString, buildSettings);

    validateShortVersion({ shortVersion, workflow });
    return shortVersion;
  } else {
    validateShortVersion({ shortVersion: exp.version, workflow });
    return exp.version;
  }
}

export async function readBuildNumberAsync(
  projectDir: string,
  exp: ExpoConfig,
  buildSettings: XCBuildConfiguration['buildSettings'],
  vcsClient: Client
): Promise<string | undefined> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient);
  if (workflow === Workflow.GENERIC) {
    const infoPlist = await readInfoPlistAsync(projectDir, buildSettings);
    return (
      infoPlist.CFBundleVersion && evaluateTemplateString(infoPlist.CFBundleVersion, buildSettings)
    );
  } else {
    return IOSConfig.Version.getBuildNumber(exp);
  }
}

export async function maybeResolveVersionsAsync(
  projectDir: string,
  exp: ExpoConfig,
  targets: Target[],
  vcsClient: Client
): Promise<{ appVersion?: string; appBuildVersion?: string }> {
  const applicationTarget = findApplicationTarget(targets);
  try {
    return {
      appBuildVersion: await readBuildNumberAsync(
        projectDir,
        exp,
        applicationTarget.buildSettings ?? {},
        vcsClient
      ),
      appVersion: await readShortVersionAsync(
        projectDir,
        exp,
        applicationTarget.buildSettings ?? {},
        vcsClient
      ),
    };
  } catch (err: any) {
    Log.warn('Failed to read app versions.');
    Log.debug(err);
    Log.warn(err.message);
    Log.warn('Proceeding anyway...');
    return {};
  }
}

export function getInfoPlistPath(
  projectDir: string,
  buildSettings: XCBuildConfiguration['buildSettings']
): string {
  if (buildSettings.INFOPLIST_FILE) {
    const infoPlistFile = buildSettings.INFOPLIST_FILE.startsWith('"')
      ? buildSettings.INFOPLIST_FILE.slice(1, -1)
      : buildSettings.INFOPLIST_FILE;
    const iosDir = path.join(projectDir, 'ios');
    const plistPath = evaluateTemplateString(infoPlistFile, {
      ...buildSettings,
      SRCROOT: iosDir,
    });
    return path.isAbsolute(plistPath) ? plistPath : path.resolve(iosDir, plistPath);
  } else {
    return IOSConfig.Paths.getInfoPlistPath(projectDir);
  }
}

async function readInfoPlistAsync(
  projectDir: string,
  buildSettings: XCBuildConfiguration['buildSettings']
): Promise<IOSConfig.InfoPlist> {
  const infoPlistPath = getInfoPlistPath(projectDir, buildSettings);
  return ((await readPlistAsync(infoPlistPath)) ?? {}) as IOSConfig.InfoPlist;
}

export async function updateNativeVersionsAsync({
  projectDir,
  version,
  buildNumber,
  targets,
}: {
  projectDir: string;
  version?: string;
  buildNumber?: string;
  targets: Target[];
}): Promise<void> {
  const project = IOSConfig.XcodeUtils.getPbxproj(projectDir);
  const iosDir = path.join(projectDir, 'ios');

  const infoPlistFiles: string[] = [];
  for (const target of targets) {
    const { targetName, buildConfiguration } = target;
    const xcBuildConfiguration = IOSConfig.Target.getXCBuildConfigurationFromPbxproj(project, {
      targetName,
      buildConfiguration,
    });
    const infoPlist = xcBuildConfiguration?.buildSettings?.INFOPLIST_FILE;
    if (infoPlist) {
      const evaluatedInfoPlistPath = trimQuotes(
        evaluateTemplateString(infoPlist, {
          SRCROOT: iosDir,
        })
      );
      const absolutePath = path.isAbsolute(evaluatedInfoPlistPath)
        ? evaluatedInfoPlistPath
        : path.join(iosDir, evaluatedInfoPlistPath);
      infoPlistFiles.push(path.normalize(absolutePath));
    }
  }
  const uniqueInfoPlistPaths = uniqBy(infoPlistFiles, i => i);
  for (const infoPlistPath of uniqueInfoPlistPaths) {
    const infoPlist = (await readPlistAsync(infoPlistPath)) as IOSConfig.InfoPlist;
    if (buildNumber) {
      infoPlist.CFBundleVersion = buildNumber;
    }
    if (version) {
      infoPlist.CFBundleShortVersionString = version;
    }
    await writePlistAsync(infoPlistPath, infoPlist);
  }
}

function trimQuotes(s: string): string {
  return s?.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

export function evaluateTemplateString(
  s: string,
  buildSettings: XCBuildConfiguration['buildSettings']
): string {
  // necessary because XCBuildConfiguration['buildSettings'] is not a plain object
  const vars = { ...buildSettings };
  return s.replace(/\$\((\w+)\)/g, (match, key) => {
    if (vars.hasOwnProperty(key)) {
      const value = String(vars[key]);
      return value.startsWith('"') ? value.slice(1, -1) : value;
    } else {
      return match;
    }
  });
}

/**
 * Returns buildNumber that will be used for the next build. If current build profile
 * has an 'autoIncrement' option set, it increments the version on server.
 */
export async function resolveRemoteBuildNumberAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectDir,
    projectId,
    exp,
    applicationTarget,
    buildProfile,
    vcsClient,
  }: {
    projectDir: string;
    projectId: string;
    exp: ExpoConfig;
    applicationTarget: Target;
    buildProfile: BuildProfile<Platform.IOS>;
    vcsClient: Client;
  }
): Promise<string> {
  const remoteVersions = await AppVersionQuery.latestVersionAsync(
    graphqlClient,
    projectId,
    AppPlatform.Ios,
    applicationTarget.bundleIdentifier
  );

  const localBuildNumber = await readBuildNumberAsync(
    projectDir,
    exp,
    applicationTarget.buildSettings ?? {},
    vcsClient
  );
  const localShortVersion = await readShortVersionAsync(
    projectDir,
    exp,
    applicationTarget.buildSettings ?? {},
    vcsClient
  );
  let currentBuildVersion: string;
  let shouldInitializeBuildNumber = false;
  if (remoteVersions?.buildVersion) {
    currentBuildVersion = remoteVersions.buildVersion;
  } else {
    if (localBuildNumber) {
      Log.log(
        chalk.green(
          'No remote versions are configured for this project, buildNumber will be initialized based on the value from the local project.'
        )
      );
      currentBuildVersion = localBuildNumber;
      shouldInitializeBuildNumber = localBuildNumber === '1';
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
    shouldInitializeBuildNumber
  ) {
    const spinner = ora(
      `Initializing buildNumber with ${chalk.bold(currentBuildVersion)}.`
    ).start();
    try {
      await AppVersionMutation.createAppVersionAsync(graphqlClient, {
        appId: projectId,
        platform: AppPlatform.Ios,
        applicationIdentifier: applicationTarget.bundleIdentifier,
        storeVersion: localShortVersion ?? '1.0.0',
        buildVersion: currentBuildVersion,
        runtimeVersion:
          (await Updates.getRuntimeVersionNullableAsync(projectDir, exp, Platform.IOS)) ??
          undefined,
      });
      spinner.succeed(`Initialized buildNumber with ${chalk.bold(currentBuildVersion)}.`);
    } catch (err) {
      spinner.fail(`Failed to initialize buildNumber with ${chalk.bold(currentBuildVersion)}.`);
      throw err;
    }
    return currentBuildVersion;
  } else {
    const nextBuildVersion = getNextBuildNumber(currentBuildVersion);
    const spinner = ora(
      `Incrementing buildNumber from ${chalk.bold(currentBuildVersion)} to ${chalk.bold(
        nextBuildVersion
      )}.`
    ).start();
    try {
      await AppVersionMutation.createAppVersionAsync(graphqlClient, {
        appId: projectId,
        platform: AppPlatform.Ios,
        applicationIdentifier: applicationTarget.bundleIdentifier,
        storeVersion: localShortVersion ?? '1.0.0',
        buildVersion: nextBuildVersion,
        runtimeVersion:
          (await Updates.getRuntimeVersionNullableAsync(projectDir, exp, Platform.IOS)) ??
          undefined,
      });
      spinner.succeed(
        `Incremented buildNumber from ${chalk.bold(currentBuildVersion)} to ${chalk.bold(
          nextBuildVersion
        )}.`
      );
    } catch (err) {
      spinner.fail(
        `Failed to increment buildNumber from ${chalk.bold(currentBuildVersion)} to ${chalk.bold(
          nextBuildVersion
        )}.`
      );
      throw err;
    }
    return nextBuildVersion;
  }
}
